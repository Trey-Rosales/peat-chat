package com.peatlink.app.ble

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import com.peatlink.ffi.MobileNode
import kotlinx.coroutines.*
import java.util.UUID

/**
 * Android BLE platform driver for peat-btle mesh.
 *
 * Dual-role: scanner (central) discovers peers, advertiser (peripheral) makes us visible.
 * GATT server accepts connections, GATT client connects to discovered peers.
 * Tick loop drives peat-btle's state machine and broadcasts sync data.
 */
@SuppressLint("MissingPermission")
class PeatBleService(
    private val context: Context,
    private val node: MobileNode
) {
    companion object {
        private const val TAG = "PeatBLE"
        val PEAT_SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d")
        val PEAT_SYNC_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b0003")
        private const val TICK_INTERVAL_MS = 3000L
        private const val TARGET_MTU = 512

        // Manufacturer data for device discovery (more reliable than 128-bit UUID filtering)
        private const val MFG_COMPANY_ID = 0xFFFF // reserved for testing
        private val MFG_MAGIC = byteArrayOf(0x50, 0x45, 0x41, 0x54) // "PEAT"
    }

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter

    private var scanner: BluetoothLeScanner? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    private val connectedGattClients = mutableMapOf<String, BluetoothGatt>() // address → client connection
    private val gattServerDevices = mutableSetOf<String>() // addresses connected to our GATT server
    private val pendingConnections = mutableSetOf<String>() // addresses we're trying to connect to
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var tickJob: Job? = null
    private var running = false
    private var localAddress: String = ""

    // Diagnostic status visible in the connection bar
    var status: String = "not started"
        private set
    var discoveredCount: Int = 0
        private set
    var connectedCount: Int = 0
        private set

    fun start() {
        if (running) return
        val adapter = bluetoothAdapter ?: run {
            status = "No Bluetooth adapter"
            Log.e(TAG, status)
            return
        }
        if (!adapter.isEnabled) {
            status = "Bluetooth OFF — enable in settings"
            Log.e(TAG, status)
            return
        }

        running = true
        status = "starting..."
        localAddress = try { adapter.address ?: "" } catch (_: Throwable) { "" }
        Log.i(TAG, "Starting BLE service...")
        Log.i(TAG, "  Adapter: ${adapter.name}, addr: $localAddress")
        Log.i(TAG, "  LE adv supported: ${adapter.isMultipleAdvertisementSupported}")

        val problems = mutableListOf<String>()

        startGattServer()
        startAdvertising(problems)
        startScanning(problems)
        startTickLoop()

        status = if (problems.isEmpty()) "scanning + advertising"
                 else "partial: ${problems.joinToString(", ")}"
        Log.i(TAG, "BLE service status: $status")
    }

    fun stop() {
        if (!running) return
        running = false
        tickJob?.cancel()
        stopScanning()
        stopAdvertising()
        stopGattServer()
        disconnectAllClients()
        scope.cancel()
        Log.i(TAG, "BLE service stopped")
    }

    // --- Scanning (Central role) ---

    private fun startScanning(problems: MutableList<String>) {
        scanner = bluetoothAdapter?.bluetoothLeScanner
        if (scanner == null) {
            problems.add("no scanner")
            Log.w(TAG, "BLE scanner not available")
            return
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        try {
            scanner?.startScan(null, settings, scanCallback)
            Log.i(TAG, "BLE scanning started")
        } catch (e: Throwable) {
            problems.add("scan failed: ${e.message}")
            Log.e(TAG, "BLE scan start failed: ${e.message}")
        }
    }

    private fun stopScanning() {
        try {
            scanner?.stopScan(scanCallback)
        } catch (_: Throwable) {}
        scanner = null
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val address = device.address
            val record = result.scanRecord ?: return
            val name = record.deviceName
            val rssi = result.rssi.toByte()
            val now = System.currentTimeMillis().toULong()

            // Check manufacturer data first (most reliable across Android OEMs)
            val mfgData = record.getManufacturerSpecificData(MFG_COMPANY_ID)
            val hasMfgMagic = mfgData != null && mfgData.size >= 4 &&
                mfgData[0] == MFG_MAGIC[0] && mfgData[1] == MFG_MAGIC[1] &&
                mfgData[2] == MFG_MAGIC[2] && mfgData[3] == MFG_MAGIC[3]

            // Fallback: check service UUID
            val hasServiceUuid = record.serviceUuids?.any { it.uuid == PEAT_SERVICE_UUID } == true

            if (!hasMfgMagic && !hasServiceUuid) return // Not a Peat device

            discoveredCount++
            Log.i(TAG, "Discovered Peat device: $address (${name ?: "unnamed"}) rssi=$rssi mfg=$hasMfgMagic uuid=$hasServiceUuid")

            // Extract mesh_id from service data if available
            val serviceData = record.getServiceData(ParcelUuid(PEAT_SERVICE_UUID))
            val meshId = serviceData?.let { String(it, Charsets.UTF_8) }

            node.onBleDiscovered(address, name, rssi, meshId, now)

            // Auto-connect if not already connected or pending
            if (!connectedGattClients.containsKey(address) &&
                !gattServerDevices.contains(address) &&
                !pendingConnections.contains(address)) {
                // Limit concurrent connection attempts
                if (pendingConnections.size < 2 && connectedGattClients.size < 3) {
                    status = "connecting to ${address.takeLast(5)}..."
                    Log.i(TAG, "Auto-connecting to $address")
                    connectToDevice(device)
                }
            }

            if (connectedCount == 0) {
                status = "found ${discoveredCount}x, connecting..."
            }
        }

        override fun onScanFailed(errorCode: Int) {
            val reason = when (errorCode) {
                1 -> "already started"
                2 -> "app registration failed"
                3 -> "internal error"
                4 -> "feature unsupported"
                5 -> "out of hardware resources"
                else -> "error $errorCode"
            }
            status = "scan failed: $reason"
            Log.e(TAG, "BLE scan failed: $reason")
        }
    }

    // --- Advertising (Peripheral role) ---

    private fun startAdvertising(problems: MutableList<String>) {
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            problems.add("no advertiser")
            Log.w(TAG, "BLE advertiser not available")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        // Main advertising packet: manufacturer data (6 bytes) — fits easily in 31 bytes
        val advData = AdvertiseData.Builder()
            .addManufacturerData(MFG_COMPANY_ID, MFG_MAGIC)
            .setIncludeDeviceName(false)
            .build()

        // Scan response: service UUID + device name
        val scanResponse = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(PEAT_SERVICE_UUID))
            .setIncludeDeviceName(true)
            .build()

        advertiser?.startAdvertising(settings, advData, scanResponse, advertiseCallback)
        Log.i(TAG, "BLE advertising started (mfg data in adv, UUID+name in scan response)")
    }

    private fun stopAdvertising() {
        try {
            advertiser?.stopAdvertising(advertiseCallback)
        } catch (_: Throwable) {}
        advertiser = null
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            Log.i(TAG, "BLE advertising active")
        }

        override fun onStartFailure(errorCode: Int) {
            val reason = when (errorCode) {
                ADVERTISE_FAILED_DATA_TOO_LARGE -> "data too large"
                ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "too many advertisers"
                ADVERTISE_FAILED_ALREADY_STARTED -> "already started"
                ADVERTISE_FAILED_INTERNAL_ERROR -> "internal error"
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "feature unsupported"
                else -> "error $errorCode"
            }
            status = "adv failed: $reason"
            Log.e(TAG, "BLE advertising failed: $reason")
        }
    }

    // --- GATT Server (accept connections from other peers) ---

    private fun startGattServer() {
        gattServer = bluetoothManager.openGattServer(context, gattServerCallback)
        val service = BluetoothGattService(PEAT_SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        val syncChar = BluetoothGattCharacteristic(
            PEAT_SYNC_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or
                BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        // Add Client Characteristic Configuration Descriptor for notifications
        val cccd = BluetoothGattDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        syncChar.addDescriptor(cccd)

        service.addCharacteristic(syncChar)
        gattServer?.addService(service)
        Log.i(TAG, "GATT server started")
    }

    private fun stopGattServer() {
        gattServer?.close()
        gattServer = null
        gattServerDevices.clear()
    }

    // Track which addresses are confirmed Peat devices
    private val knownPeatDevices = mutableSetOf<String>()
    // Track notified peer names to prevent duplicate registration from dual connections
    private val notifiedPeerNames = mutableSetOf<String>()

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status_code: Int, newState: Int) {
            val address = device.address
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    // Don't register with peat-btle yet — wait until they write to our
                    // sync characteristic (proves they're a Peat device, not a random BLE device)
                    Log.i(TAG, "GATT server: incoming connection from $address (unverified)")
                    gattServerDevices.add(address)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT server: disconnected from $address")
                    gattServerDevices.remove(address)
                    if (knownPeatDevices.remove(address)) {
                        node.onBleDisconnected(address)
                        node.notifyBlePeerDisconnected(address)
                        connectedCount = knownPeatDevices.size
                    }
                    if (connectedCount == 0 && knownPeatDevices.isEmpty()) {
                        this@PeatBleService.status = "scanning + advertising"
                    }
                }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val doc = node.bleBuildDocument()
                val data = doc?.let { list -> ByteArray(list.size) { list[it].toByte() } } ?: ByteArray(0)
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset,
                    if (offset < data.size) data.copyOfRange(offset, data.size) else ByteArray(0))
            } else {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_FAILURE, 0, null)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray
        ) {
            if (characteristic.uuid == PEAT_SYNC_CHAR_UUID && value.isNotEmpty()) {
                val address = device.address
                val now = System.currentTimeMillis().toULong()

                // First write from this device = verified Peat peer
                if (!knownPeatDevices.contains(address)) {
                    Log.i(TAG, "GATT server: verified Peat peer $address (first sync write)")
                    val name = try { device.name } catch (_: Throwable) { null }
                    node.onBleDiscovered(address, name, 0, "peatlink-default", now)
                    node.onBleConnected(address, now)
                    val peerKey = name ?: address
                    if (notifiedPeerNames.add(peerKey)) {
                        connectedCount = notifiedPeerNames.size
                        node.notifyBlePeerConnected(address, name ?: "BLE-${address.takeLast(5)}")
                        this@PeatBleService.status = "peer verified: ${name ?: address.takeLast(5)}"
                        Log.i(TAG, "GATT server: verified NEW PeatLink peer $address ($name)")
                    }
                    knownPeatDevices.add(address)
                }

                Log.d(TAG, "GATT server: received ${value.size} bytes from $address")
                node.onBleDataReceived(address, value.map { it.toUByte() }, now)
                totalReceived++
                node.pushBleRecv(value.map { it.toUByte() })
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            } else if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray
        ) {
            // Client enabling/disabling notifications
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }

    // --- GATT Client (connect to discovered peers) ---

    private fun connectToDevice(device: BluetoothDevice) {
        val address = device.address
        if (connectedGattClients.containsKey(address)) return
        if (gattServerDevices.contains(address)) return
        if (pendingConnections.contains(address)) return

        pendingConnections.add(address)
        Log.i(TAG, "GATT client: connecting to $address")
        try {
            val gatt = device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
            if (gatt != null) {
                connectedGattClients[address] = gatt
            } else {
                pendingConnections.remove(address)
                Log.w(TAG, "connectGatt returned null for $address")
            }
        } catch (e: Throwable) {
            pendingConnections.remove(address)
            Log.e(TAG, "connectGatt failed for $address: ${e.message}")
        }
    }

    private fun disconnectAllClients() {
        for ((_, gatt) in connectedGattClients) {
            try {
                gatt.disconnect()
                gatt.close()
            } catch (_: Throwable) {}
        }
        connectedGattClients.clear()
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status_code: Int, newState: Int) {
            val address = gatt.device.address
            val now = System.currentTimeMillis().toULong()
            pendingConnections.remove(address)

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    // Don't mark as Peat peer yet — wait for service discovery to confirm
                    Log.i(TAG, "GATT client: connected to $address (unverified, discovering services...)")
                    node.onBleConnected(address, now)
                    gatt.requestMtu(TARGET_MTU)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT client: disconnected from $address (status=$status_code)")
                    if (knownPeatDevices.remove(address)) {
                        node.onBleDisconnected(address)
                        node.notifyBlePeerDisconnected(address)
                        connectedCount = knownPeatDevices.size
                    }
                    connectedGattClients.remove(address)
                    pendingConnections.remove(address)
                    try { gatt.close() } catch (_: Throwable) {}
                    if (connectedCount == 0) {
                        this@PeatBleService.status = "scanning + advertising"
                    }
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            negotiatedMtu = mtu
            Log.i(TAG, "MTU changed to $mtu for ${gatt.device.address} (max write: ${mtu - 3} bytes)")
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device.address
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.w(TAG, "Service discovery failed for $address, disconnecting")
                gatt.disconnect()
                return
            }

            val service = gatt.getService(PEAT_SERVICE_UUID)
            if (service == null) {
                // NOT a PeatLink device — disconnect
                Log.i(TAG, "No Peat service on $address — not a PeatLink device, disconnecting")
                connectedGattClients.remove(address)
                pendingConnections.remove(address)
                gatt.disconnect()
                gatt.close()
                return
            }

            val syncChar = service.getCharacteristic(PEAT_SYNC_CHAR_UUID)
            if (syncChar == null) {
                Log.w(TAG, "Sync characteristic not found on $address")
                return
            }

            // Service verified — THIS is a real PeatLink peer
            knownPeatDevices.add(address)
            val name = try { gatt.device.name } catch (_: Throwable) { null }
            val peerKey = name ?: address // dedup by name (same device may have different addresses)

            if (notifiedPeerNames.add(peerKey)) {
                // First time seeing this physical device
                connectedCount = notifiedPeerNames.size
                node.notifyBlePeerConnected(address, name ?: "BLE-${address.takeLast(5)}")
                this@PeatBleService.status = "verified peer: ${name ?: address.takeLast(5)}"
                Log.i(TAG, "GATT client: verified NEW PeatLink peer $address ($name)")
            } else {
                Log.i(TAG, "GATT client: verified PeatLink peer $address ($name) — already registered")
            }

            // Enable notifications
            gatt.setCharacteristicNotification(syncChar, true)
            val cccd = syncChar.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
            cccd?.let {
                it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(it)
            }

            // Read peer's initial document
            gatt.readCharacteristic(syncChar)

            // Send our document to the peer (initial sync)
            scope.launch {
                delay(500) // small delay to let descriptor write complete
                val doc = node.bleBuildDocument()
                if (doc != null) {
                    val bytes = ByteArray(doc.size) { doc[it].toByte() }
                    syncChar.value = bytes
                    syncChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    gatt.writeCharacteristic(syncChar)
                    Log.i(TAG, "Sent initial document (${bytes.size} bytes) to ${gatt.device.address}")
                }
            }

            Log.i(TAG, "Subscribed to sync notifications from ${gatt.device.address}")
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val data = characteristic.value ?: return
                val now = System.currentTimeMillis().toULong()
                Log.d(TAG, "GATT client: read ${data.size} bytes from ${gatt.device.address}")
                node.onBleDataReceived(gatt.device.address, data.map { it.toUByte() }, now)
                totalReceived++
                node.pushBleRecv(data.map { it.toUByte() })
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val data = characteristic.value ?: return
                val now = System.currentTimeMillis().toULong()
                Log.d(TAG, "GATT client: notification ${data.size} bytes from ${gatt.device.address}")
                node.onBleDataReceived(gatt.device.address, data.map { it.toUByte() }, now)
                totalReceived++
                node.pushBleRecv(data.map { it.toUByte() })
            }
        }
    }

    // --- Tick loop ---

    private var tickCount = 0
    private var lastDataSize = 0
    private var negotiatedMtu = 23

    // Write queue — only one GATT write at a time
    private val writeQueue = java.util.concurrent.ConcurrentLinkedQueue<ByteArray>()
    @Volatile private var writeInFlight = false

    // Sync progress tracking
    var pendingSendCount: Int = 0
        private set
    var totalSent: Int = 0
        private set
    var totalReceived: Int = 0
        private set

    private fun startTickLoop() {
        tickJob = scope.launch {
            while (isActive && running) {
                try {
                    tickCount++

                    // Also run peat-btle tick for mesh state management
                    val now = System.currentTimeMillis().toULong()
                    val meshData = node.bleTick(now)
                    if (meshData != null) {
                        val bytes = ByteArray(meshData.size) { meshData[it].toByte() }
                        broadcastToAllPeers(bytes)
                    }

                    // Send any queued bridge data via GATT (direct transport)
                    var sent = 0
                    while (true) {
                        val bridgeData = node.popBleSend() ?: break
                        val bytes = ByteArray(bridgeData.size) { bridgeData[it].toByte() }
                        broadcastToAllPeers(bytes)
                        sent++
                    }

                    if (tickCount % 10 == 0 && (sent > 0 || knownPeatDevices.isNotEmpty())) {
                        Log.i(TAG, "Tick #$tickCount: sent $sent bridge msgs, mesh=${meshData?.size ?: 0}b, peers=${knownPeatDevices.size}")
                    }
                } catch (e: Throwable) {
                    Log.w(TAG, "Tick error: ${e.message}")
                }
                delay(TICK_INTERVAL_MS)
            }
        }
    }

    /**
     * Broadcast data to all connected BLE peers with automatic chunking.
     * Messages larger than MTU are split into chunks with reassembly headers.
     *
     * Chunk header (4 bytes): [type, msgId, seqNum, totalChunks]
     * type: 0x00 = single (no chunking), 0x01 = chunked
     */
    /**
     * Queue data for broadcast to all BLE peers.
     * Data must fit in a single GATT write (MTU - 3 bytes).
     * Large messages should be split at the bridge level, not here.
     */
    private fun broadcastToAllPeers(data: ByteArray) {
        val maxWrite = negotiatedMtu - 3
        if (data.size > maxWrite) {
            Log.w(TAG, "Data too large for single GATT write: ${data.size} > $maxWrite, dropping")
            return
        }
        writeQueue.add(data)
        pendingSendCount = writeQueue.size
        drainWriteQueue()
    }

    /**
     * Send ONE packet from the queue. Called after each successful write callback.
     */
    private fun drainWriteQueue() {
        if (writeInFlight) return
        val packet = writeQueue.poll() ?: return
        writeInFlight = true
        pendingSendCount = writeQueue.size
        totalSent++

        // Write to GATT client connections (with response for reliability)
        for ((address, gatt) in connectedGattClients.toMap()) {
            try {
                val service = gatt.getService(PEAT_SERVICE_UUID) ?: continue
                val char = service.getCharacteristic(PEAT_SYNC_CHAR_UUID) ?: continue
                char.value = packet
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                gatt.writeCharacteristic(char)
            } catch (e: Throwable) {
                Log.w(TAG, "Write failed to $address: ${e.message}")
            }
        }

        // Notify GATT server clients
        val server = gattServer
        val svc = server?.getService(PEAT_SERVICE_UUID)
        val chr = svc?.getCharacteristic(PEAT_SYNC_CHAR_UUID)
        if (chr != null) {
            chr.value = packet
            for (address in gattServerDevices.toList()) {
                try {
                    val device = bluetoothAdapter?.getRemoteDevice(address) ?: continue
                    server.notifyCharacteristicChanged(device, chr, false)
                } catch (e: Throwable) {
                    Log.w(TAG, "Notify failed to $address: ${e.message}")
                }
            }
        }

        // For WRITE_TYPE_NO_RESPONSE, there's no onCharacteristicWrite callback.
        // Use a small delay then send the next packet.
        scope.launch {
            delay(20) // 20ms between writes — allows BLE controller to flush
            writeInFlight = false
            drainWriteQueue()
        }
    }

}

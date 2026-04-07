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

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status_code: Int, newState: Int) {
            val address = device.address
            val now = System.currentTimeMillis().toULong()
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedCount++
                    this@PeatBleService.status = "peer connected: ${address.takeLast(5)}"
                    Log.i(TAG, "GATT server: peer connected from $address (status=$status_code)")
                    gattServerDevices.add(address)
                    node.onBleConnected(address, now)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedCount = (connectedCount - 1).coerceAtLeast(0)
                    Log.i(TAG, "GATT server: peer disconnected from $address (status=$status_code)")
                    gattServerDevices.remove(address)
                    node.onBleDisconnected(address)
                    if (connectedCount == 0) {
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
            if (characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val now = System.currentTimeMillis().toULong()
                node.onBleDataReceived(device.address, value.map { it.toUByte() }, now)
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
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
                    connectedCount++
                    this@PeatBleService.status = "connected: ${address.takeLast(5)}"
                    Log.i(TAG, "GATT client: connected to $address (status=$status_code)")
                    node.onBleConnected(address, now)
                    gatt.requestMtu(TARGET_MTU)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedCount = (connectedCount - 1).coerceAtLeast(0)
                    Log.i(TAG, "GATT client: disconnected from $address (status=$status_code)")
                    node.onBleDisconnected(address)
                    connectedGattClients.remove(address)
                    try { gatt.close() } catch (_: Throwable) {}
                    if (connectedCount == 0) {
                        this@PeatBleService.status = "scanning + advertising"
                    }
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            Log.i(TAG, "MTU changed to $mtu for ${gatt.device.address}")
            // After MTU negotiation, discover services
            gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.w(TAG, "Service discovery failed for ${gatt.device.address}")
                return
            }

            val service = gatt.getService(PEAT_SERVICE_UUID)
            if (service == null) {
                Log.w(TAG, "Peat service not found on ${gatt.device.address}")
                return
            }

            val syncChar = service.getCharacteristic(PEAT_SYNC_CHAR_UUID)
            if (syncChar == null) {
                Log.w(TAG, "Sync characteristic not found on ${gatt.device.address}")
                return
            }

            // Enable notifications
            gatt.setCharacteristicNotification(syncChar, true)
            val cccd = syncChar.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
            cccd?.let {
                it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(it)
            }

            // Read initial document
            gatt.readCharacteristic(syncChar)

            Log.i(TAG, "Subscribed to sync notifications from ${gatt.device.address}")
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val data = characteristic.value ?: return
                val now = System.currentTimeMillis().toULong()
                node.onBleDataReceived(gatt.device.address, data.map { it.toUByte() }, now)
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == PEAT_SYNC_CHAR_UUID) {
                val data = characteristic.value ?: return
                val now = System.currentTimeMillis().toULong()
                node.onBleDataReceived(gatt.device.address, data.map { it.toUByte() }, now)
            }
        }
    }

    // --- Tick loop ---

    private fun startTickLoop() {
        tickJob = scope.launch {
            while (isActive && running) {
                try {
                    val now = System.currentTimeMillis().toULong()
                    val data = node.bleTick(now)
                    if (data != null) {
                        val bytes = ByteArray(data.size) { data[it].toByte() }
                        broadcastToAllPeers(bytes)
                    }
                } catch (e: Throwable) {
                    Log.w(TAG, "Tick error: ${e.message}")
                }
                delay(TICK_INTERVAL_MS)
            }
        }
    }

    /**
     * Broadcast data to all connected BLE peers:
     * - Write to GATT servers we're connected to as a client
     * - Notify all GATT clients connected to our server
     */
    private fun broadcastToAllPeers(data: ByteArray) {
        // Write to peers where we're the GATT client
        for ((address, gatt) in connectedGattClients) {
            try {
                val service = gatt.getService(PEAT_SERVICE_UUID) ?: continue
                val char = service.getCharacteristic(PEAT_SYNC_CHAR_UUID) ?: continue
                char.value = data
                char.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                gatt.writeCharacteristic(char)
            } catch (e: Throwable) {
                Log.w(TAG, "Failed to write to $address: ${e.message}")
            }
        }

        // Notify peers connected to our GATT server
        val server = gattServer ?: return
        val service = server.getService(PEAT_SERVICE_UUID) ?: return
        val char = service.getCharacteristic(PEAT_SYNC_CHAR_UUID) ?: return
        char.value = data

        for (address in gattServerDevices.toList()) {
            try {
                val device = bluetoothAdapter?.getRemoteDevice(address) ?: continue
                server.notifyCharacteristicChanged(device, char, false)
            } catch (e: Throwable) {
                Log.w(TAG, "Failed to notify $address: ${e.message}")
            }
        }
    }
}

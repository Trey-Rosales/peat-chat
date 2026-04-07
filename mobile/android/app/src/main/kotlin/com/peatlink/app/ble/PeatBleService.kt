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
    }

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager.adapter

    private var scanner: BluetoothLeScanner? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    private val connectedGattClients = mutableMapOf<String, BluetoothGatt>() // address → client connection
    private val gattServerDevices = mutableSetOf<String>() // addresses connected to our GATT server
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var tickJob: Job? = null
    private var running = false

    fun start() {
        if (running) return
        val adapter = bluetoothAdapter ?: run {
            Log.e(TAG, "Bluetooth not available")
            return
        }
        if (!adapter.isEnabled) {
            Log.w(TAG, "Bluetooth not enabled")
            return
        }

        running = true
        startGattServer()
        startAdvertising()
        startScanning()
        startTickLoop()
        Log.i(TAG, "BLE service started")
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

    private fun startScanning() {
        scanner = bluetoothAdapter?.bluetoothLeScanner
        if (scanner == null) {
            Log.w(TAG, "BLE scanner not available")
            return
        }

        // Don't use a ScanFilter for the 128-bit UUID — some Android devices
        // silently fail to match 128-bit UUIDs in advertising packets.
        // Instead, scan for all connectable devices and filter in the callback.
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        scanner?.startScan(null, settings, scanCallback)
        Log.i(TAG, "BLE scanning started (unfiltered, checking in callback)")
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

            // Check if this is a Peat device by looking for our service UUID
            val serviceUuids = record.serviceUuids
            val isPeatDevice = serviceUuids?.any { it.uuid == PEAT_SERVICE_UUID } == true

            if (!isPeatDevice) return // Not a Peat device, skip

            Log.d(TAG, "Discovered Peat device: $address (${name ?: "unnamed"}) rssi=$rssi")

            // Extract mesh_id from service data if available
            val serviceData = record.getServiceData(ParcelUuid(PEAT_SERVICE_UUID))
            val meshId = serviceData?.let { String(it, Charsets.UTF_8) }

            node.onBleDiscovered(address, name, rssi, meshId, now)

            // Auto-connect if not already connected (either direction)
            if (!connectedGattClients.containsKey(address) && !gattServerDevices.contains(address)) {
                connectToDevice(device)
            }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: error $errorCode")
        }
    }

    // --- Advertising (Peripheral role) ---

    private fun startAdvertising() {
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            Log.w(TAG, "BLE advertiser not available")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0)
            .build()

        // Service UUID in main advertising packet (18 bytes for 128-bit UUID)
        val advData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(PEAT_SERVICE_UUID))
            .setIncludeDeviceName(false) // Name goes in scan response to stay under 31 bytes
            .build()

        // Device name in scan response (separate 31-byte packet)
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()

        advertiser?.startAdvertising(settings, advData, scanResponse, advertiseCallback)
        Log.i(TAG, "BLE advertising started (UUID in adv, name in scan response)")
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
            Log.e(TAG, "BLE advertising failed: error $errorCode")
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
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val address = device.address
            val now = System.currentTimeMillis().toULong()
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT server: peer connected from $address")
                    gattServerDevices.add(address)
                    node.onBleConnected(address, now)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT server: peer disconnected from $address")
                    gattServerDevices.remove(address)
                    node.onBleDisconnected(address)
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
        if (gattServerDevices.contains(address)) return // already connected via server role

        Log.i(TAG, "GATT client: connecting to $address")
        val gatt = device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        connectedGattClients[address] = gatt
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
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device.address
            val now = System.currentTimeMillis().toULong()

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT client: connected to $address")
                    node.onBleConnected(address, now)
                    // Request higher MTU for efficient document sync
                    gatt.requestMtu(TARGET_MTU)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT client: disconnected from $address")
                    node.onBleDisconnected(address)
                    connectedGattClients.remove(address)
                    gatt.close()
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

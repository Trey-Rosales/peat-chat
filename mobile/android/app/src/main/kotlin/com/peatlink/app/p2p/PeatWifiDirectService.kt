package com.peatlink.app.p2p

import android.annotation.SuppressLint
import android.content.*
import android.net.NetworkInfo
import android.net.wifi.p2p.*
import android.net.wifi.p2p.nsd.*
import android.util.Log
import kotlinx.coroutines.*
import java.net.InetAddress

/**
 * Android WiFi Direct platform driver for PeatLink mesh.
 *
 * Uses DNS-SD service advertisement and discovery to find other PeatLink
 * peers on the local network. Handles group formation with automatic
 * Group Owner election (upstream-bearing nodes become GO).
 *
 * Follows the same lifecycle pattern as PeatBleService: start() / stop()
 * with callbacks for connection events.
 */
@SuppressLint("MissingPermission")
class PeatWifiDirectService(
    private val context: Context,
    private val port: Int,
    private val nodeId: String,
    private val callsign: String,
    private val hasUpstream: Boolean,
) {
    companion object {
        private const val TAG = "PeatWifiDirect"
        private const val SERVICE_TYPE = "_peatlink._tcp"
        private const val SERVICE_NAME = "peatlink"
        private const val DISCOVER_DURATION_MS = 30_000L
        private const val DISCOVER_PAUSE_MS = 60_000L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var manager: WifiP2pManager? = null
    private var channel: WifiP2pManager.Channel? = null
    private var receiver: BroadcastReceiver? = null
    private var discoverJob: Job? = null

    /** Discovered PeatLink peers (MAC address -> TXT record map). */
    private val discoveredPeers = mutableMapOf<String, Map<String, String>>()

    // --- Callbacks ---
    var onGroupFormed: ((isOwner: Boolean, ownerAddress: InetAddress?) -> Unit)? = null
    var onPeerConnected: ((deviceName: String) -> Unit)? = null
    var onPeerDisconnected: (() -> Unit)? = null

    // --- Observable state ---
    @Volatile var isGroupOwner = false
        private set
    @Volatile var groupOwnerAddress: InetAddress? = null
        private set
    @Volatile var connectedPeerCount = 0
        private set
    @Volatile var status = "off"
    @Volatile var running = false
        private set

    private val intentFilter = IntentFilter().apply {
        addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
    }

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------

    fun start() {
        if (running) return

        manager = try {
            context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to get WifiP2pManager: ${e.message}")
            status = "P2P unavailable"
            return
        }
        if (manager == null) {
            status = "P2P not supported"
            Log.e(TAG, status)
            return
        }

        running = true

        // Try to initialize the channel — retry periodically if WiFi isn't ready
        if (!tryInitChannel()) {
            status = "standby"
            startRetryLoop()
            return
        }

        finishStart()
    }

    private fun tryInitChannel(): Boolean {
        channel = try {
            manager!!.initialize(context, context.mainLooper, null)
        } catch (e: Throwable) {
            Log.w(TAG, "WiFi Direct init deferred (WiFi may be off): ${e.message}")
            null
        }
        return channel != null
    }

    private fun startRetryLoop() {
        discoverJob = scope.launch {
            while (isActive && running && channel == null) {
                delay(15_000) // retry every 15 seconds
                if (tryInitChannel()) {
                    Log.i(TAG, "WiFi Direct channel initialized on retry")
                    // Must register receiver and start discovery on main thread context
                    kotlinx.coroutines.withContext(Dispatchers.Main) {
                        finishStart()
                    }
                    return@launch
                }
            }
        }
    }

    private fun finishStart() {
        status = "starting..."
        Log.i(TAG, "Starting WiFi Direct service (node=$nodeId, callsign=$callsign, upstream=$hasUpstream, port=$port)")

        // Register broadcast receiver
        if (receiver == null) {
            val recv = WifiDirectReceiver()
            receiver = recv
            try {
                context.registerReceiver(recv, intentFilter)
            } catch (e: Throwable) {
                Log.e(TAG, "registerReceiver failed: ${e.message}")
            }
        }

        // Advertise our service via DNS-SD
        registerLocalService()

        // Set up discovery listeners and begin duty-cycle loop
        setupServiceDiscovery()
        discoverJob?.cancel() // cancel retry loop if running
        startDiscoverLoop()

        status = "discovering"
        Log.i(TAG, "WiFi Direct service started")
    }

    fun stop() {
        running = false
        discoverJob?.cancel()
        discoverJob = null

        try { manager?.removeGroup(channel, null) } catch (_: Throwable) {}
        try { manager?.clearLocalServices(channel, null) } catch (_: Throwable) {}
        try { manager?.clearServiceRequests(channel, null) } catch (_: Throwable) {}
        try { context.unregisterReceiver(receiver) } catch (_: Throwable) {}
        receiver = null

        discoveredPeers.clear()
        isGroupOwner = false
        groupOwnerAddress = null
        connectedPeerCount = 0
        status = "off"
        Log.i(TAG, "WiFi Direct service stopped")
    }

    /** Manual re-scan trigger (e.g. from UI pull-to-refresh). */
    fun forceDiscover() {
        if (!running) return
        try {
            manager?.discoverServices(channel, loggingActionListener("forceDiscover"))
        } catch (e: Throwable) {
            Log.w(TAG, "forceDiscover failed: ${e.message}")
        }
    }

    // ---------------------------------------------------------------
    // DNS-SD Service Advertisement
    // ---------------------------------------------------------------

    private fun registerLocalService() {
        val txtRecord = mapOf(
            "node_id" to nodeId,
            "port" to port.toString(),
            "callsign" to callsign,
            "has_upstream" to hasUpstream.toString(),
        )

        val serviceInfo = WifiP2pDnsSdServiceInfo.newInstance(
            SERVICE_NAME,
            SERVICE_TYPE,
            txtRecord,
        )

        try {
            manager?.addLocalService(channel, serviceInfo, loggingActionListener("addLocalService"))
            Log.i(TAG, "Registered DNS-SD service: $SERVICE_NAME ($SERVICE_TYPE) txt=$txtRecord")
        } catch (e: Throwable) {
            Log.e(TAG, "addLocalService failed: ${e.message}")
        }
    }

    // ---------------------------------------------------------------
    // DNS-SD Service Discovery
    // ---------------------------------------------------------------

    private fun setupServiceDiscovery() {
        val txtListener = WifiP2pManager.DnsSdTxtRecordListener { _, record, device ->
            Log.i(TAG, "Found PeatLink peer: ${record["callsign"]} on ${device.deviceName} (${device.deviceAddress})")
            discoveredPeers[device.deviceAddress] = record
        }

        val serviceListener = WifiP2pManager.DnsSdServiceResponseListener { instanceName, _, device ->
            if (instanceName == SERVICE_NAME) {
                Log.i(TAG, "PeatLink service on ${device.deviceName} (${device.deviceAddress})")
                // Auto-connect if we found a peer with upstream and we are not already GO
                val record = discoveredPeers[device.deviceAddress]
                if (record?.get("has_upstream") == "true" && !isGroupOwner) {
                    connectToPeer(device)
                }
            }
        }

        try {
            manager?.setDnsSdResponseListeners(channel, serviceListener, txtListener)
        } catch (e: Throwable) {
            Log.e(TAG, "setDnsSdResponseListeners failed: ${e.message}")
        }

        val serviceRequest = WifiP2pDnsSdServiceRequest.newInstance(SERVICE_TYPE)
        try {
            manager?.addServiceRequest(channel, serviceRequest, loggingActionListener("addServiceRequest"))
        } catch (e: Throwable) {
            Log.e(TAG, "addServiceRequest failed: ${e.message}")
        }
    }

    // ---------------------------------------------------------------
    // Peer Connection
    // ---------------------------------------------------------------

    private fun connectToPeer(device: WifiP2pDevice) {
        val config = WifiP2pConfig().apply {
            deviceAddress = device.deviceAddress
            // Upstream-bearing node strongly prefers to be Group Owner
            groupOwnerIntent = if (hasUpstream) 15 else 0
        }
        try {
            manager?.connect(channel, config, loggingActionListener("connect to ${device.deviceName}"))
        } catch (e: Throwable) {
            Log.e(TAG, "connect failed: ${e.message}")
        }
    }

    // ---------------------------------------------------------------
    // Discovery Duty Cycle
    // ---------------------------------------------------------------

    private fun startDiscoverLoop() {
        discoverJob = scope.launch {
            while (isActive && running) {
                try {
                    manager?.discoverServices(channel, loggingActionListener("discoverServices"))
                    delay(DISCOVER_DURATION_MS)
                    try {
                        manager?.stopPeerDiscovery(channel, null)
                    } catch (_: Throwable) {}
                    delay(DISCOVER_PAUSE_MS)
                } catch (e: CancellationException) {
                    throw e // Don't swallow cancellation
                } catch (e: Throwable) {
                    Log.w(TAG, "Discover loop error: ${e.message}")
                    delay(10_000)
                }
            }
        }
    }

    // ---------------------------------------------------------------
    // Broadcast Receiver
    // ---------------------------------------------------------------

    @Suppress("DEPRECATION")
    private inner class WifiDirectReceiver : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
                    val state = intent.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, -1)
                    if (state == WifiP2pManager.WIFI_P2P_STATE_ENABLED) {
                        Log.i(TAG, "WiFi P2P is enabled")
                    } else {
                        status = "WiFi P2P disabled"
                        Log.w(TAG, status)
                    }
                }

                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
                    // Peer list changed; DNS-SD listeners handle our specific service
                    Log.d(TAG, "Peer list changed")
                }

                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                    val networkInfo = intent.getParcelableExtra<NetworkInfo>(
                        WifiP2pManager.EXTRA_NETWORK_INFO
                    )
                    if (networkInfo?.isConnected == true) {
                        handleConnected()
                    } else {
                        handleDisconnected()
                    }
                }

                WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
                    val device = intent.getParcelableExtra<WifiP2pDevice>(
                        WifiP2pManager.EXTRA_WIFI_P2P_DEVICE
                    )
                    Log.i(TAG, "This device: ${device?.deviceName} status=${device?.status}")
                }
            }
        }
    }

    private fun handleConnected() {
        try {
            manager?.requestConnectionInfo(channel) { info ->
                if (info == null) {
                    Log.w(TAG, "requestConnectionInfo returned null")
                    return@requestConnectionInfo
                }
                isGroupOwner = info.isGroupOwner
                groupOwnerAddress = info.groupOwnerAddress
                status = if (isGroupOwner) "GO" else "client"
                Log.i(TAG, "Connected: isGO=$isGroupOwner, goAddr=${info.groupOwnerAddress}")
                onGroupFormed?.invoke(isGroupOwner, groupOwnerAddress)
            }
        } catch (e: Throwable) {
            Log.e(TAG, "requestConnectionInfo failed: ${e.message}")
        }

        // Also request group info for accurate peer count
        try {
            manager?.requestGroupInfo(channel) { group ->
                if (group == null) {
                    Log.d(TAG, "requestGroupInfo returned null")
                    return@requestGroupInfo
                }
                connectedPeerCount = group.clientList?.size ?: 0
                Log.i(TAG, "Group: ${group.networkName}, clients=${connectedPeerCount}")
                group.clientList?.forEach { device ->
                    onPeerConnected?.invoke(device.deviceName)
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "requestGroupInfo failed: ${e.message}")
        }
    }

    private fun handleDisconnected() {
        connectedPeerCount = 0
        isGroupOwner = false
        groupOwnerAddress = null
        status = if (running) "disconnected" else "off"
        Log.i(TAG, "Disconnected from WiFi Direct group")
        onPeerDisconnected?.invoke()
    }

    // ---------------------------------------------------------------
    // Utility
    // ---------------------------------------------------------------

    private fun loggingActionListener(action: String) = object : WifiP2pManager.ActionListener {
        override fun onSuccess() {
            Log.d(TAG, "$action succeeded")
        }

        override fun onFailure(reason: Int) {
            val msg = when (reason) {
                WifiP2pManager.BUSY -> "BUSY (normal if no peers nearby)"
                WifiP2pManager.ERROR -> "ERROR"
                WifiP2pManager.P2P_UNSUPPORTED -> "P2P_UNSUPPORTED"
                else -> "UNKNOWN($reason)"
            }
            Log.w(TAG, "$action failed: $msg")
        }
    }
}

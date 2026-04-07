package com.peatlink.app.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * Discovers PeatLink Go servers on the local network via mDNS/DNS-SD.
 * The Go server advertises as _peatlink._tcp.
 */
class ServerDiscovery(private val context: Context) {

    companion object {
        private const val TAG = "PeatLinkNSD"
        private const val SERVICE_TYPE = "_peatlink._tcp"
    }

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private var onServerFound: ((String, Int) -> Unit)? = null

    /**
     * Start discovering PeatLink servers. Calls [callback] with (host, port)
     * when a server is found and resolved.
     */
    fun startDiscovery(callback: (host: String, port: Int) -> Unit) {
        onServerFound = callback
        stopDiscovery() // clean up any prior listener

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {
                Log.i(TAG, "mDNS discovery started for $serviceType")
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "found service: ${serviceInfo.serviceName} (${serviceInfo.serviceType})")
                nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                        Log.w(TAG, "resolve failed for ${info.serviceName}: error $errorCode")
                    }

                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val host = info.host?.hostAddress ?: return
                        val port = info.port
                        Log.i(TAG, "resolved PeatLink server at $host:$port")
                        onServerFound?.invoke(host, port)
                    }
                })
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.i(TAG, "service lost: ${serviceInfo.serviceName}")
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.i(TAG, "mDNS discovery stopped")
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "discovery start failed: error $errorCode")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "discovery stop failed: error $errorCode")
            }
        }

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
    }

    fun stopDiscovery() {
        discoveryListener?.let {
            try {
                nsdManager.stopServiceDiscovery(it)
            } catch (_: Exception) {}
        }
        discoveryListener = null
    }
}

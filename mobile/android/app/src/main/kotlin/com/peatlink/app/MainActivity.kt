package com.peatlink.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*

// UniFFI-generated bindings (available after cross-compilation + bindgen)
// import com.peatlink.ffi.MobileNode
// import com.peatlink.ffi.BlePeerInfo
// import com.peatlink.ffi.peatlink_version

/**
 * PeatLink native Android shell.
 *
 * Lifecycle:
 * 1. Request BLE permissions
 * 2. Start embedded Rust server (peat-mesh + axum WS) via UniFFI
 * 3. Start BLE mesh via peat-btle
 * 4. Load React UI in WebView pointing at localhost:{port}
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "PeatLink"
        private const val BLE_PERMISSION_REQUEST = 1001
        private const val AUDIO_PERMISSION_REQUEST = 1002

        private val BLE_PERMISSIONS = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_ADVERTISE,
            )
        } else {
            arrayOf(
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION,
            )
        }
    }

    private lateinit var webView: WebView
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    // Uncomment once native .so is cross-compiled and UniFFI bindings generated:
    // private var node: MobileNode? = null
    private var serverPort: Int = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT

            webViewClient = WebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    // Grant audio permission to WebView for getUserMedia
                    val granted = request.resources.filter { res ->
                        res == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }.toTypedArray()
                    if (granted.isNotEmpty()) {
                        request.grant(granted)
                    } else {
                        request.deny()
                    }
                }
            }

            setBackgroundColor(android.graphics.Color.parseColor("#0b141a"))
        }

        setContentView(webView)

        // Request permissions, then start
        requestPermissions()
    }

    private fun requestPermissions() {
        val allPerms = BLE_PERMISSIONS.toMutableList()
        allPerms.add(Manifest.permission.RECORD_AUDIO)

        val missing = allPerms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), BLE_PERMISSION_REQUEST)
        } else {
            onPermissionsGranted()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == BLE_PERMISSION_REQUEST) {
            val bleGranted = BLE_PERMISSIONS.all {
                ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
            }
            val audioGranted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED

            if (bleGranted) Log.i(TAG, "BLE permissions granted")
            else Log.w(TAG, "Some BLE permissions denied — mesh networking may be limited")
            if (audioGranted) Log.i(TAG, "Audio permission granted")
            else Log.w(TAG, "Audio permission denied — voice channels will not work")

            // Start regardless — text chat works without BLE or audio
            onPermissionsGranted()
        }
    }

    private fun onPermissionsGranted() {
        scope.launch {
            startPeatLink()
        }
    }

    private suspend fun startPeatLink() {
        withContext(Dispatchers.IO) {
            // ===== START EMBEDDED RUST SERVER =====
            // Uncomment once UniFFI bindings are available:
            //
            // try {
            //     val dataDir = filesDir.absolutePath + "/peatlink"
            //     node = MobileNode(dataDir, "Android User")
            //     serverPort = node!!.start(null).toInt()
            //     Log.i(TAG, "Rust server started on port $serverPort")
            //
            //     // Start BLE mesh
            //     try {
            //         node!!.startBle(
            //             meshId = "peatlink-default",
            //             callsign = "ANDROID-${node!!.nodeId().take(6)}",
            //             sharedSecret = null  // or a pre-shared key
            //         )
            //         Log.i(TAG, "BLE mesh started")
            //     } catch (e: Exception) {
            //         Log.w(TAG, "BLE mesh failed to start: ${e.message}")
            //     }
            // } catch (e: Exception) {
            //     Log.e(TAG, "Failed to start Rust server: ${e.message}")
            //     serverPort = 8090  // fallback to external server
            // }

            // TEMPORARY: Use external server until cross-compilation is set up
            serverPort = 8090
        }

        val url = "http://localhost:$serverPort"
        Log.i(TAG, "Loading web UI from $url")
        webView.loadUrl(url)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
        webView.destroy()

        // Uncomment once UniFFI bindings available:
        // scope.launch(Dispatchers.IO) {
        //     try { node?.stop() } catch (_: Exception) {}
        // }
    }
}

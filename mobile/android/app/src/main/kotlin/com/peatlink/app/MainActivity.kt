package com.peatlink.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.view.Gravity
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

import com.peatlink.app.ble.BleVoiceService
import com.peatlink.app.ble.PeatBleService
import com.peatlink.app.net.ServerDiscovery

/**
 * PeatLink native Android shell.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "PeatLink"
        private const val BLE_PERMISSION_REQUEST = 1001

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

    private lateinit var rootLayout: FrameLayout
    private lateinit var webView: WebView
    private lateinit var statusText: TextView
    private lateinit var connBar: TextView
    private lateinit var prefs: PeatLinkPrefs
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var node: Any? = null
    private var serverPort: Int = 0
    private var discovery: ServerDiscovery? = null
    private var bleService: PeatBleService? = null
    private var bleVoice: BleVoiceService? = null
    private var serverStarted = false
    private var connStatusJob: Job? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = PeatLinkPrefs(this)
        prefs.initializeIfNeeded()

        // Use a vertical LinearLayout: connBar on top, then webView/statusText below
        val outerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0b141a"))
        }

        // Connection status bar — tappable, non-overlapping
        connBar = TextView(this).apply {
            setBackgroundColor(Color.parseColor("#1b2b34"))
            setTextColor(Color.parseColor("#8696a0"))
            textSize = 12f
            gravity = Gravity.CENTER
            setPadding(16, 10, 16, 10)
            text = "Not connected to server"
            visibility = View.GONE
            setOnClickListener { showSettingsDialog() }
        }
        outerLayout.addView(connBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // FrameLayout holds either statusText or webView
        rootLayout = FrameLayout(this)

        statusText = TextView(this).apply {
            setTextColor(Color.parseColor("#8696a0"))
            textSize = 16f
            gravity = Gravity.CENTER
            text = "Starting PeatLink..."
            setPadding(48, 0, 48, 0)
        }
        rootLayout.addView(statusText, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        webView = WebView(this).apply {
            visibility = View.GONE
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setGeolocationEnabled(true)

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: android.webkit.WebResourceRequest
                ): Boolean {
                    val host = request.url.host ?: ""
                    return !(host == "localhost" || host == "127.0.0.1")
                }

            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val origin = request.origin.toString()
                    if (!origin.startsWith("http://localhost") && !origin.startsWith("https://localhost")) {
                        request.deny()
                        return
                    }
                    val granted = request.resources.filter { res ->
                        res == PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }.toTypedArray()
                    if (granted.isNotEmpty()) request.grant(granted) else request.deny()
                }

                override fun onGeolocationPermissionsShowPrompt(
                    origin: String,
                    callback: GeolocationPermissions.Callback
                ) {
                    val local = origin.startsWith("http://localhost") || origin.startsWith("https://localhost")
                    callback.invoke(origin, local, false)
                }
            }

            setBackgroundColor(Color.parseColor("#0b141a"))

            // JavaScript bridge for BLE voice PTT
            addJavascriptInterface(object {
                @JavascriptInterface
                fun startPtt(senderId: String, senderName: String) {
                    bleVoice?.startTransmitting()
                }

                @JavascriptInterface
                fun stopPtt() {
                    bleVoice?.stopTransmitting()
                }

                @JavascriptInterface
                fun isTransmitting(): Boolean {
                    return bleVoice?.transmitting ?: false
                }

                @JavascriptInterface
                fun hasBleVoice(): Boolean {
                    return bleVoice != null
                }

                /** Set voice mode: "ptt", "noise_gate", or "auto" */
                @JavascriptInterface
                fun setVoiceMode(mode: String) {
                    bleVoice?.voiceMode = when (mode) {
                        "noise_gate" -> BleVoiceService.VoiceMode.NOISE_GATE
                        "auto" -> BleVoiceService.VoiceMode.AUTO
                        else -> BleVoiceService.VoiceMode.PTT
                    }
                    // Start/stop continuous capture based on mode
                    if (mode == "noise_gate" || mode == "auto") {
                        bleVoice?.startContinuous()
                    } else {
                        bleVoice?.stopContinuous()
                    }
                }

                /** Set noise gate threshold in dB (typically -60 to -20) */
                @JavascriptInterface
                fun setNoiseGateThreshold(db: Float) {
                    bleVoice?.noiseGateThresholdDb = db
                }

                /** Get current mic level in dB for visual meter */
                @JavascriptInterface
                fun getMicLevelDb(): Float {
                    return bleVoice?.currentMicLevelDb ?: -96f
                }

                /** Get whether voice is currently detected */
                @JavascriptInterface
                fun isVoiceDetected(): Boolean {
                    return bleVoice?.voiceDetected ?: false
                }

                @JavascriptInterface
                fun setMicMuted(muted: Boolean) {
                    bleVoice?.muted = muted
                }

                @JavascriptInterface
                fun isMicMuted(): Boolean {
                    return bleVoice?.muted ?: false
                }

                @JavascriptInterface
                fun getVoiceMode(): String {
                    return when (bleVoice?.voiceMode) {
                        BleVoiceService.VoiceMode.NOISE_GATE -> "noise_gate"
                        BleVoiceService.VoiceMode.AUTO -> "auto"
                        else -> "ptt"
                    }
                }

                @JavascriptInterface
                fun pollIncomingFrames(): String {
                    // Return decoded PCM from BLE peers for WebRTC injection
                    val frames = bleVoice?.drainDecodedPcm() ?: return "[]"
                    if (frames.isEmpty()) return "[]"
                    val arr = JSONArray()
                    for (pcm in frames) {
                        arr.put(JSONObject().apply {
                            put("pcm", Base64.encodeToString(pcm, Base64.NO_WRAP))
                        })
                    }
                    return arr.toString()
                }

                @JavascriptInterface
                fun sendPcmFrame(base64Pcm: String, senderId: String, senderName: String) {
                    // Receive WebRTC audio (Mac), encode to Opus, send via BLE
                    try {
                        val pcm = Base64.decode(base64Pcm, Base64.DEFAULT)
                        bleVoice?.ingestPcmFromWebRTC(pcm)
                    } catch (e: Throwable) {
                        Log.w(TAG, "sendPcmFrame: ${e.message}")
                    }
                }
            }, "PeatLinkVoice")
        }
        rootLayout.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        outerLayout.addView(rootLayout, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        setContentView(outerLayout)
        requestPermissions()
    }

    private fun requestPermissions() {
        val allPerms = BLE_PERMISSIONS.toMutableList()
        allPerms.add(Manifest.permission.RECORD_AUDIO)
        allPerms.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            allPerms.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }

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
            // Start regardless of which permissions were granted
            onPermissionsGranted()
        }
    }

    private fun onPermissionsGranted() {
        if (serverStarted) return
        scope.launch {
            startPeatLink()
        }
    }

    private suspend fun startPeatLink() {
        updateStatus("Extracting web UI...")

        var startupError: String? = null

        withContext(Dispatchers.IO) {
            try {
                // Step 1: Copy web assets
                val webDir = copyWebAssetsToFilesDir()
                Log.i(TAG, "Web UI extracted to $webDir")

                withContext(Dispatchers.Main) { updateStatus("Loading native library...") }

                // Step 2: Load native library and create MobileNode
                // This is where UnsatisfiedLinkError would be thrown
                val mobileNode = com.peatlink.ffi.MobileNode(
                    filesDir.absolutePath + "/peatlink",
                    prefs.callsign.ifEmpty { "Android User" }
                )
                node = mobileNode

                withContext(Dispatchers.Main) { updateStatus("Starting server...") }

                // Step 3: Start the embedded server
                serverPort = mobileNode.start(webDir).toInt()
                serverStarted = true
                Log.i(TAG, "Rust server started on port $serverPort")

                // Save identity
                val nodeId = mobileNode.nodeId()
                if (prefs.identity.isEmpty()) {
                    prefs.identity = nodeId
                }

                // Apply callsign
                if (prefs.callsign.isNotEmpty()) {
                    mobileNode.setDisplayName(prefs.callsign)
                }

                // Step 4: Start BLE mesh + platform BLE service (non-fatal if fails)
                try {
                    mobileNode.startBle(
                        meshId = "peatlink-default",
                        callsign = prefs.callsign.ifEmpty { "Android" },
                        sharedSecret = null
                    )
                    Log.i(TAG, "BLE mesh started")

                    // Start Android BLE platform driver (scanner, advertiser, GATT)
                    val svc = PeatBleService(this@MainActivity, mobileNode)
                    svc.start()
                    bleService = svc
                    Log.i(TAG, "BLE platform service started")

                    // Start BLE voice audio service (native, no WebView)
                    val voice = BleVoiceService()
                    voice.start()
                    bleVoice = voice
                    // Wire voice to BLE transport
                    svc.voiceService = voice
                    Log.i(TAG, "BLE voice service started (native Opus 8kbps)")
                } catch (e: Throwable) {
                    Log.w(TAG, "BLE mesh/service failed: ${e.message}")
                }

                // Step 5: Connect upstream relay BEFORE WebView loads
                // so the passthrough channel has a subscriber when the
                // WebView sends set_name
                val savedUrl = prefs.upstreamUrl
                if (savedUrl.isNotEmpty() && prefs.autoConnect) {
                    try {
                        mobileNode.connectUpstream(savedUrl, "general")
                        Log.i(TAG, "Upstream relay connected to $savedUrl")
                    } catch (e: Throwable) {
                        Log.w(TAG, "Upstream relay failed: ${e.message}")
                    }
                }

            } catch (e: Throwable) {
                // Catch EVERYTHING — including UnsatisfiedLinkError, NoClassDefFoundError, etc.
                val msg = "${e.javaClass.simpleName}: ${e.message}"
                Log.e(TAG, "Startup failed: $msg", e)
                startupError = msg
            }
        }

        if (startupError != null) {
            updateStatus("Startup failed:\n\n$startupError\n\nCheck logcat for details.")
            return
        }

        // Success — show WebView
        statusText.visibility = android.view.View.GONE
        webView.visibility = android.view.View.VISIBLE

        val url = "http://localhost:$serverPort"
        Log.i(TAG, "Loading web UI from $url")
        webView.loadUrl(url)

        prefs.markFirstLaunchDone()

        // Start server discovery (non-fatal)
        try {
            startServerDiscovery()
        } catch (e: Throwable) {
            Log.w(TAG, "Server discovery failed: ${e.message}")
        }

        // Show connection bar and start polling status
        connBar.visibility = View.VISIBLE
        startConnStatusPolling()
    }

    private fun updateStatus(msg: String) {
        statusText.text = msg
        statusText.visibility = android.view.View.VISIBLE
    }

    private fun startServerDiscovery() {
        // Always run mDNS discovery to find/update servers
        try {
            discovery = ServerDiscovery(this)
            discovery?.startDiscovery { host, port ->
                val wsUrl = "ws://$host:$port/ws"
                Log.i(TAG, "Discovered PeatLink server at $wsUrl")

                val mobileNode = node as? com.peatlink.ffi.MobileNode ?: return@startDiscovery

                // Save discovered URL
                prefs.upstreamUrl = wsUrl

                // Connect if not already connected
                if (!mobileNode.isUpstreamConnected()) {
                    connectUpstream(wsUrl)
                    runOnUiThread {
                        Toast.makeText(this, "Auto-discovered server at $host:$port", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        } catch (e: Throwable) {
            Log.w(TAG, "NSD discovery failed to start: ${e.message}")
        }
    }

    private fun connectUpstream(wsUrl: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val mobileNode = node as? com.peatlink.ffi.MobileNode ?: return@launch
                mobileNode.connectUpstream(wsUrl, "general")
                Log.i(TAG, "Upstream relay connected to $wsUrl")
            } catch (e: Throwable) {
                Log.w(TAG, "Upstream relay failed: ${e.message}")
            }
        }
    }

    private fun startConnStatusPolling() {
        connStatusJob?.cancel()
        connStatusJob = scope.launch {
            while (true) {
                val mobileNode = node as? com.peatlink.ffi.MobileNode
                val upstreamConnected = try {
                    mobileNode?.isUpstreamConnected() == true
                } catch (_: Throwable) { false }

                val bleStatus = bleService?.status ?: "off"
                val bleConnected = bleService?.connectedCount ?: 0
                val bleDiscovered = bleService?.discoveredCount ?: 0
                val blePeerCount = try {
                    mobileNode?.blePeers()?.count { it.isConnected } ?: 0
                } catch (_: Throwable) { 0 }

                // Use the higher of GATT connections and peat-btle peer count
                val effectiveBleCount = maxOf(bleConnected, blePeerCount)

                val url = prefs.upstreamUrl

                val bleSent = bleService?.totalSent ?: 0
                val bleRecv = bleService?.totalReceived ?: 0
                val blePending = bleService?.pendingSendCount ?: 0

                val parts = mutableListOf<String>()
                if (upstreamConnected) parts.add("Server \u2713")
                if (effectiveBleCount > 0) {
                    var blePart = "BLE: $effectiveBleCount peer${if (effectiveBleCount != 1) "s" else ""}"
                    if (bleSent > 0 || bleRecv > 0) {
                        blePart += " \u2191$bleSent \u2193$bleRecv"
                    }
                    if (blePending > 0) {
                        blePart += " (${blePending} queued)"
                    }
                    parts.add(blePart)
                } else if (bleStatus != "off" && bleStatus != "not started") {
                    parts.add("BLE: $bleStatus")
                }

                if (parts.isNotEmpty()) {
                    connBar.setBackgroundColor(Color.parseColor(
                        if (upstreamConnected) "#00a884" else "#8b5cf6" // green for server, purple for BLE-only
                    ))
                    connBar.setTextColor(Color.parseColor("#0b141a"))
                    connBar.text = parts.joinToString(" | ")
                } else if (url.isNotEmpty()) {
                    connBar.setBackgroundColor(Color.parseColor("#e8a030"))
                    connBar.setTextColor(Color.parseColor("#0b141a"))
                    connBar.text = "\u23f3 Connecting to $url..."
                } else {
                    connBar.setBackgroundColor(Color.parseColor("#1b2b34"))
                    connBar.setTextColor(Color.parseColor("#8696a0"))
                    connBar.text = "\u2699 Tap to connect to a server"
                }

                // Periodically re-send callsign to keep it synced
                try {
                    val callsign = prefs.callsign
                    if (callsign.isNotEmpty() && mobileNode != null) {
                        mobileNode.setDisplayName(callsign)
                    }
                } catch (_: Throwable) {}

                delay(2000)
            }
        }
    }

    private fun showSettingsDialog() {
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 32, 48, 16)
        }

        val callsignInput = EditText(this).apply {
            hint = "Callsign"
            setText(prefs.callsign)
        }
        layout.addView(callsignInput)

        val upstreamInput = EditText(this).apply {
            hint = "Upstream server URL (auto-discovered)"
            setText(prefs.upstreamUrl)
        }
        layout.addView(upstreamInput)

        AlertDialog.Builder(this)
            .setTitle("PeatLink Settings")
            .setView(layout)
            .setPositiveButton("Save") { _, _ ->
                val newCallsign = callsignInput.text.toString().trim()
                val newUpstream = upstreamInput.text.toString().trim()

                if (newCallsign.isNotEmpty() && newCallsign != prefs.callsign) {
                    prefs.callsign = newCallsign
                    (node as? com.peatlink.ffi.MobileNode)?.setDisplayName(newCallsign)
                    Toast.makeText(this, "Callsign updated", Toast.LENGTH_SHORT).show()
                }

                if (newUpstream != prefs.upstreamUrl) {
                    prefs.upstreamUrl = newUpstream
                    if (newUpstream.isNotEmpty()) {
                        scope.launch(Dispatchers.IO) {
                            try {
                                (node as? com.peatlink.ffi.MobileNode)?.disconnectUpstream()
                            } catch (_: Throwable) {}
                            connectUpstream(newUpstream)
                        }
                    }
                }
            }
            .setNeutralButton("Reset Identity") { _, _ ->
                AlertDialog.Builder(this)
                    .setTitle("Reset Identity?")
                    .setMessage("This generates a new device ID and callsign.")
                    .setPositiveButton("Reset") { _, _ ->
                        prefs.resetAll()
                        prefs.initializeIfNeeded()
                        (node as? com.peatlink.ffi.MobileNode)?.regenerateIdentity()
                        (node as? com.peatlink.ffi.MobileNode)?.setDisplayName(prefs.callsign)
                        Toast.makeText(this, "Identity reset: ${prefs.callsign}", Toast.LENGTH_LONG).show()
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun copyWebAssetsToFilesDir(): String {
        val webDir = File(filesDir, "web")
        if (webDir.exists()) webDir.deleteRecursively()
        webDir.mkdirs()
        copyAssetDir("web", webDir)
        return webDir.absolutePath
    }

    private fun copyAssetDir(assetPath: String, destDir: File) {
        val children = assets.list(assetPath)
        if (children.isNullOrEmpty()) {
            destDir.parentFile?.mkdirs()
            assets.open(assetPath).use { input ->
                destDir.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        } else {
            destDir.mkdirs()
            for (child in children) {
                copyAssetDir("$assetPath/$child", File(destDir, child))
            }
        }
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
        try { discovery?.stopDiscovery() } catch (_: Throwable) {}
        webView.destroy()

        try { bleVoice?.stop() } catch (_: Throwable) {}
        bleVoice = null
        try { bleService?.stop() } catch (_: Throwable) {}
        bleService = null

        val n = node as? com.peatlink.ffi.MobileNode
        node = null
        if (n != null) {
            Thread {
                try { n.stopBle() } catch (_: Throwable) {}
                try { n.disconnectUpstream() } catch (_: Throwable) {}
                try { n.stop() } catch (_: Throwable) {}
                n.destroy()
            }.start()
        }
    }
}

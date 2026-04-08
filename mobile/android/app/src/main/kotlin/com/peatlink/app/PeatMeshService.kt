package com.peatlink.app

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.peatlink.app.ble.BleVoiceService
import com.peatlink.app.ble.PeatBleService
import com.peatlink.app.p2p.PeatWifiDirectService

class PeatMeshService : Service() {

    companion object {
        private const val TAG = "PeatMeshService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "peatlink_mesh"
        const val ACTION_START = "com.peatlink.app.START_MESH"
        const val ACTION_STOP = "com.peatlink.app.STOP_MESH"
    }

    inner class LocalBinder : Binder() {
        val service: PeatMeshService get() = this@PeatMeshService
    }

    private val binder = LocalBinder()

    // These are set by MainActivity when it binds to the service
    var mobileNode: com.peatlink.ffi.MobileNode? = null
    var bleService: PeatBleService? = null
    var bleVoice: BleVoiceService? = null
    var wifiDirectService: PeatWifiDirectService? = null

    @Volatile var isRunning = false
        private set

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startForegroundMesh()
            ACTION_STOP -> stopForegroundMesh()
        }
        return START_STICKY
    }

    private fun startForegroundMesh() {
        if (isRunning) return
        isRunning = true

        createNotificationChannel()
        val notification = buildNotification("Mesh active")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+: must specify foreground service types
            try {
                startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            } catch (e: Throwable) {
                // Fallback for devices that don't support the type
                startForeground(NOTIFICATION_ID, notification)
            }
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        Log.i(TAG, "Foreground mesh service started")
    }

    fun updateNotification(status: String) {
        if (!isRunning) return
        try {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, buildNotification(status))
        } catch (_: Throwable) {}
    }

    private fun stopForegroundMesh() {
        isRunning = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        Log.i(TAG, "Foreground mesh service stopped")
    }

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "PeatLink Mesh",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the mesh network active in the background"
                setShowBadge(false)
            }
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(status: String): Notification {
        // Tapping the notification opens the app
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Stop action
        val stopIntent = Intent(this, PeatMeshService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PeatLink Mesh")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth) // system BT icon as placeholder
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_delete, "Stop", stopPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }
}

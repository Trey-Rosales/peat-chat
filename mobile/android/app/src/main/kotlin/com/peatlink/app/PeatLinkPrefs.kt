package com.peatlink.app

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

/**
 * Persists user settings (callsign, identity, upstream URL) across app launches.
 */
class PeatLinkPrefs(context: Context) {

    companion object {
        private const val PREFS_NAME = "peatlink_settings"
        private const val KEY_CALLSIGN = "callsign"
        private const val KEY_IDENTITY = "identity"
        private const val KEY_UPSTREAM_URL = "upstream_url"
        private const val KEY_FIRST_LAUNCH = "first_launch"
        private const val KEY_AUTO_CONNECT = "auto_connect"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val isFirstLaunch: Boolean
        get() = prefs.getBoolean(KEY_FIRST_LAUNCH, true)

    fun markFirstLaunchDone() {
        prefs.edit().putBoolean(KEY_FIRST_LAUNCH, false).apply()
    }

    var callsign: String
        get() = prefs.getString(KEY_CALLSIGN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_CALLSIGN, value).apply()

    var identity: String
        get() = prefs.getString(KEY_IDENTITY, "") ?: ""
        set(value) = prefs.edit().putString(KEY_IDENTITY, value).apply()

    var upstreamUrl: String
        get() = prefs.getString(KEY_UPSTREAM_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_UPSTREAM_URL, value).apply()

    var autoConnect: Boolean
        get() = prefs.getBoolean(KEY_AUTO_CONNECT, true)
        set(value) = prefs.edit().putBoolean(KEY_AUTO_CONNECT, value).apply()

    /**
     * Initialize defaults if first launch.
     * Returns true if this was the first launch.
     */
    fun initializeIfNeeded(): Boolean {
        if (!isFirstLaunch) return false

        if (callsign.isEmpty()) {
            callsign = "ANDROID-${UUID.randomUUID().toString().take(6).uppercase()}"
        }
        // identity will be set from the MobileNode after it starts
        return true
    }

    /**
     * Reset all data (new identity, new callsign).
     */
    fun resetAll() {
        prefs.edit()
            .remove(KEY_IDENTITY)
            .remove(KEY_CALLSIGN)
            .remove(KEY_UPSTREAM_URL)
            .putBoolean(KEY_FIRST_LAUNCH, true)
            .apply()
    }
}

package com.markspace.tasks.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

data class SyncPrefs(
    val token: String = "",
    val remoteUrl: String = "",
    val lastSyncAt: String? = null,
    /** 0 = off; else minutes */
    val autoSyncMinutes: Int = 0,
    val cloned: Boolean = false,
)

class SyncPreferences(context: Context) {
    private val appContext = context.applicationContext

    private val prefs: SharedPreferences by lazy {
        try {
            val masterKey = MasterKey.Builder(appContext)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                appContext,
                "markspace_sync_secure",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (_: Exception) {
            appContext.getSharedPreferences("markspace_sync", Context.MODE_PRIVATE)
        }
    }

    fun load(): SyncPrefs = SyncPrefs(
        token = prefs.getString(KEY_TOKEN, "") ?: "",
        remoteUrl = prefs.getString(KEY_REMOTE, "") ?: "",
        lastSyncAt = prefs.getString(KEY_LAST_SYNC, null),
        autoSyncMinutes = prefs.getInt(KEY_AUTO, 0),
        cloned = prefs.getBoolean(KEY_CLONED, false),
    )

    fun save(prefsData: SyncPrefs) {
        prefs.edit()
            .putString(KEY_TOKEN, prefsData.token)
            .putString(KEY_REMOTE, prefsData.remoteUrl)
            .putString(KEY_LAST_SYNC, prefsData.lastSyncAt)
            .putInt(KEY_AUTO, prefsData.autoSyncMinutes)
            .putBoolean(KEY_CLONED, prefsData.cloned)
            .apply()
    }

    fun vaultDir(): File = File(appContext.filesDir, "vault").also { it.mkdirs() }

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_REMOTE = "remoteUrl"
        private const val KEY_LAST_SYNC = "lastSyncAt"
        private const val KEY_AUTO = "autoSyncMinutes"
        private const val KEY_CLONED = "cloned"
    }
}

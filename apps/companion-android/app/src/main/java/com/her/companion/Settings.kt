package com.her.companion

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Persistent settings stored in EncryptedSharedPreferences. Reads:
 *   shareUrl: e.g. https://her.phnet.me/api/share
 *   ingestToken: the X-Ingest-Token value matching the server's INGEST_TOKEN
 *   allowlist: set of package names to forward (empty = forward all,
 *              but recommended to populate to limit blast radius)
 *
 * Storage is encrypted at rest via AndroidX Security MasterKey (AES-256-GCM)
 * so even if your phone is physically stolen, the ingest token isn't trivially
 * recoverable from disk.
 */
data class Settings(
    val shareUrl: String,
    val ingestToken: String,
    val allowlist: Set<String>
) {
    fun isConfigured(): Boolean = shareUrl.isNotBlank() && ingestToken.isNotBlank()
    fun shareUrl(): String = shareUrl  // Used by Forwarder for clarity.

    companion object {
        private const val PREFS_FILE = "her_companion_prefs"
        private const val KEY_URL = "share_url"
        private const val KEY_TOKEN = "ingest_token"
        private const val KEY_ALLOWLIST = "allowlist_csv"

        fun load(ctx: Context): Settings {
            val prefs = encryptedPrefs(ctx)
            val csv = prefs.getString(KEY_ALLOWLIST, "") ?: ""
            return Settings(
                shareUrl = prefs.getString(KEY_URL, "").orEmpty(),
                ingestToken = prefs.getString(KEY_TOKEN, "").orEmpty(),
                allowlist = csv.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
            )
        }

        fun save(ctx: Context, settings: Settings) {
            encryptedPrefs(ctx).edit().apply {
                putString(KEY_URL, settings.shareUrl)
                putString(KEY_TOKEN, settings.ingestToken)
                putString(KEY_ALLOWLIST, settings.allowlist.joinToString(","))
            }.apply()
        }

        private fun encryptedPrefs(ctx: Context) =
            EncryptedSharedPreferences.create(
                ctx,
                PREFS_FILE,
                MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
    }
}

/** Plain-old DTO for the payload Forwarder posts. */
data class NotificationPayload(
    val source: String,
    val sourcePackage: String,
    val sourceAppLabel: String,
    val title: String,
    val text: String,
    val fromName: String,
    val fromAddress: String,
    val receivedAt: String
)

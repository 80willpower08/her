package com.her.companion

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import java.time.Instant

/**
 * The single Android service this app runs. Android delivers every notification
 * that gets posted to the status bar to onNotificationPosted(). We:
 *   1. Filter against the user's allowlist of source packages.
 *   2. Extract title, text, big-text body when available.
 *   3. Dedupe against very recent same-content notifications.
 *   4. Hand off to Forwarder which POSTs to /api/share asynchronously.
 *
 * Nothing else. No analytics. No background scraping. No remote-config.
 * Audit the source: this file is the entire "listener" surface.
 */
class HerNotificationListener : NotificationListenerService() {

    private val recentlySeen = LruDedupCache(capacity = 64, windowMs = 30_000L)

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val settings = Settings.load(applicationContext)
        if (!settings.isConfigured()) return  // No URL/token yet → don't try.
        if (settings.allowlist.isNotEmpty() && sbn.packageName !in settings.allowlist) return
        if (sbn.packageName == applicationContext.packageName) return  // Ignore own notifs.

        val n = sbn.notification ?: return
        val extras = n.extras ?: return

        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        // bigText (full body) preferred over text (preview); fall back to text.
        val bodyText = (
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            )?.toString().orEmpty()

        if (title.isBlank() && bodyText.isBlank()) return

        val dedupeKey = "${sbn.packageName}|$title|${bodyText.take(80)}"
        if (recentlySeen.seenRecently(dedupeKey)) return

        val appLabel = resolveAppLabel(sbn.packageName)

        val payload = NotificationPayload(
            source = "NOTIFICATION",
            sourcePackage = sbn.packageName,
            sourceAppLabel = appLabel,
            title = title,
            text = bodyText,
            fromName = title.takeIf { it.isNotBlank() } ?: appLabel,
            fromAddress = "notification:${sbn.packageName}",
            receivedAt = Instant.ofEpochMilli(sbn.postTime).toString()
        )

        Forwarder.enqueue(payload, settings)
    }

    override fun onListenerConnected() {
        Log.i(TAG, "Notification listener connected")
    }

    private fun resolveAppLabel(packageName: String): String =
        try {
            val pm = applicationContext.packageManager
            val info = pm.getApplicationInfo(packageName, 0)
            pm.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }

    companion object {
        private const val TAG = "HerListener"
    }
}

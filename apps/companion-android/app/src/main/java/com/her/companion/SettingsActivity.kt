package com.her.companion

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

/**
 * The one and only visible screen. Lets the user:
 *   1. Set the API base URL (e.g. https://her.phnet.me/api/share).
 *   2. Paste the ingest token from her's environment.
 *   3. Provide a CSV allowlist of source package names to forward.
 *   4. Jump to Android's "Notification access" settings to enable the listener.
 *
 * No other UI. No backend. Audit the source: this entire screen is below.
 */
class SettingsActivity : Activity() {
    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText
    private lateinit var allowlistField: EditText
    private lateinit var statusText: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        urlField = findViewById(R.id.field_url)
        tokenField = findViewById(R.id.field_token)
        allowlistField = findViewById(R.id.field_allowlist)
        statusText = findViewById(R.id.text_status)

        val current = Settings.load(this)
        urlField.setText(current.shareUrl)
        tokenField.setText(current.ingestToken)
        allowlistField.setText(current.allowlist.joinToString(","))

        findViewById<Button>(R.id.btn_save).setOnClickListener { saveAndReport() }
        findViewById<Button>(R.id.btn_open_listener_settings).setOnClickListener {
            startActivity(Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        findViewById<Button>(R.id.btn_test).setOnClickListener { testForward() }
        updateStatus()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun saveAndReport() {
        val s = Settings(
            shareUrl = urlField.text.toString().trim(),
            ingestToken = tokenField.text.toString().trim(),
            allowlist = allowlistField.text.toString()
                .split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        )
        Settings.save(this, s)
        Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show()
        updateStatus()
    }

    private fun testForward() {
        val s = Settings.load(this)
        if (!s.isConfigured()) {
            Toast.makeText(this, "Set URL + token first", Toast.LENGTH_SHORT).show()
            return
        }
        val payload = NotificationPayload(
            source = "NOTIFICATION",
            sourcePackage = packageName,
            sourceAppLabel = "her-companion test",
            title = "Test notification from companion",
            text = "If you see this row in her's inbox, plumbing works end-to-end.",
            fromName = "her-companion",
            fromAddress = "notification:$packageName",
            receivedAt = java.time.Instant.now().toString()
        )
        Forwarder.enqueue(payload, s)
        Toast.makeText(this, "Test queued", Toast.LENGTH_SHORT).show()
    }

    private fun updateStatus() {
        val s = Settings.load(this)
        val listenerGranted = isListenerAccessGranted()
        val configured = s.isConfigured()
        val parts = mutableListOf<String>()
        parts += if (configured) "url+token: OK" else "url+token: MISSING"
        parts += if (listenerGranted) "listener: ENABLED" else "listener: DISABLED (open access settings below)"
        parts += if (s.allowlist.isEmpty()) "allowlist: empty (would forward ALL apps)"
                 else "allowlist: ${s.allowlist.size} apps"
        statusText.text = parts.joinToString("\n")
    }

    private fun isListenerAccessGranted(): Boolean {
        val flat = AndroidSettings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?: return false
        val target = "$packageName/${HerNotificationListener::class.java.name}"
        return flat.split(":").any { it.contains(packageName) && it.contains(target.substringAfter('/')) }
    }
}

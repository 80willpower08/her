package com.her.companion

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Telephony
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Reads inbound SMS from Android's content provider and forwards each message
 * to /api/share so the agent gets historical thread context for ongoing
 * conversations. Only runs when the user explicitly taps "Start backfill".
 *
 * Permission READ_SMS is requested at runtime here, not at install time.
 * Outbound (sent) messages are skipped — her only ingests inbound.
 *
 * Auditable surface: this entire activity is below.
 */
class SmsBackfillActivity : Activity() {
    private lateinit var rangeSpinner: Spinner
    private lateinit var statusText: TextView
    private lateinit var startBtn: Button
    private lateinit var stopBtn: Button

    private val executor = Executors.newSingleThreadExecutor()
    private val running = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_sms_backfill)

        rangeSpinner = findViewById(R.id.range_spinner)
        statusText = findViewById(R.id.text_status)
        startBtn = findViewById(R.id.btn_start)
        stopBtn = findViewById(R.id.btn_stop)

        val rangeLabels = arrayOf("Last 7 days", "Last 30 days", "Last 90 days", "All time")
        rangeSpinner.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, rangeLabels
        )

        startBtn.setOnClickListener { handleStart() }
        stopBtn.setOnClickListener { running.set(false); startBtn.isEnabled = true; stopBtn.isEnabled = false }
        stopBtn.isEnabled = false
    }

    private fun handleStart() {
        val settings = Settings.load(this)
        if (!settings.isConfigured()) {
            Toast.makeText(this, "Set URL + token on the main screen first", Toast.LENGTH_LONG).show()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.READ_SMS), 1)
            return
        }
        runBackfill(settings)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            runBackfill(Settings.load(this))
        } else {
            statusText.text = "READ_SMS not granted — cannot read history"
        }
    }

    private fun runBackfill(settings: Settings) {
        val days = when (rangeSpinner.selectedItemPosition) {
            0 -> 7
            1 -> 30
            2 -> 90
            else -> 0  // 0 = no cutoff
        }
        val cutoffMs = if (days == 0) 0L else System.currentTimeMillis() - days * 86_400_000L

        running.set(true)
        startBtn.isEnabled = false
        stopBtn.isEnabled = true

        executor.submit {
            var forwarded = 0
            var scanned = 0
            try {
                val projection = arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE,
                    Telephony.Sms.TYPE,
                )
                val selection = if (cutoffMs > 0) "${Telephony.Sms.DATE} >= ?" else null
                val args = if (cutoffMs > 0) arrayOf(cutoffMs.toString()) else null
                val sort = "${Telephony.Sms.DATE} ASC"

                contentResolver.query(
                    Telephony.Sms.CONTENT_URI, projection, selection, args, sort
                )?.use { cursor ->
                    val idxAddr = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                    val idxBody = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
                    val idxDate = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
                    val idxType = cursor.getColumnIndexOrThrow(Telephony.Sms.TYPE)

                    while (cursor.moveToNext()) {
                        if (!running.get()) break
                        scanned += 1
                        val type = cursor.getInt(idxType)
                        // Skip outbound — her ingests messages TO the user.
                        if (type != Telephony.Sms.MESSAGE_TYPE_INBOX) continue
                        val address = cursor.getString(idxAddr) ?: continue
                        val body = cursor.getString(idxBody) ?: continue
                        val date = cursor.getLong(idxDate)

                        val payload = NotificationPayload(
                            source = "SMS",
                            sourcePackage = "com.her.companion.backfill",
                            sourceAppLabel = "SMS Backfill",
                            title = "",
                            text = body,
                            fromName = address,
                            fromAddress = address,
                            receivedAt = Instant.ofEpochMilli(date).toString()
                        )
                        Forwarder.enqueue(payload, settings)
                        forwarded += 1

                        if (forwarded % 25 == 0) {
                            runOnUiThread {
                                statusText.text = "Forwarded $forwarded / scanned $scanned…"
                            }
                        }
                    }
                }
            } finally {
                running.set(false)
                runOnUiThread {
                    statusText.text = "Done. Forwarded $forwarded (scanned $scanned)."
                    startBtn.isEnabled = true
                    stopBtn.isEnabled = false
                }
            }
        }
    }
}

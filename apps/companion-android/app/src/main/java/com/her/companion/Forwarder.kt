package com.her.companion

import android.util.Log
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Background HTTP forwarder. Posts NotificationPayloads to /api/share with the
 * X-Ingest-Token header. No retries on failure — if your network is down
 * we drop the event. (The user's daily summary still captures most state via
 * the Gmail/Outlook API ingestion; this is a fast-path enrichment.)
 *
 * This file is the ONLY place that touches the network. Auditable.
 */
object Forwarder {
    private val executor = Executors.newSingleThreadExecutor()
    private const val TAG = "HerForwarder"

    fun enqueue(payload: NotificationPayload, settings: Settings) {
        executor.submit { post(payload, settings) }
    }

    private fun post(payload: NotificationPayload, settings: Settings) {
        val url = URL(settings.shareUrl())
        val conn = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Ingest-Token", settings.ingestToken)
        }
        try {
            val body = JSONObject().apply {
                put("source", payload.source)
                put("sourcePackage", payload.sourcePackage)
                put("sourceAppLabel", payload.sourceAppLabel)
                put("title", payload.title)
                put("text", payload.text)
                put("fromName", payload.fromName)
                put("fromAddress", payload.fromAddress)
                put("receivedAt", payload.receivedAt)
            }.toString()
            OutputStreamWriter(conn.outputStream).use { it.write(body) }
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "share rejected: HTTP $code for pkg=${payload.sourcePackage}")
            }
        } catch (e: Exception) {
            Log.w(TAG, "share failed for pkg=${payload.sourcePackage}: ${e.message}")
        } finally {
            conn.disconnect()
        }
    }
}

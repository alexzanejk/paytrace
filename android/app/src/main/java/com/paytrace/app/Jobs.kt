package com.paytrace.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** A job the owner wrote in the dashboard for one agent: what to do, how urgent it is, and the wallet address to do it with and the network that address is on (for example "BNB Smart Chain (BEP20)"). An agent is
 *  one wallet on this phone (its bKash, Nagad, Rocket or Upay); the job shows while that wallet's newest balance is at or above the
 *  owner's amount. PayTrace only shows it; the agent does the work outside the app and taps Done. The instruction text already has
 *  {agent}, {provider} and {balance} filled in by the server. [urgency] is "normal", "urgent" or "critical". */
data class Job(
    val provider: String,
    val agent: String,
    val urgency: String,
    val balance: Double,
    val balanceAt: String,
    val threshold: Double,
    val wallet: String,
    val network: String,
    val instruction: String,
)

object JobsParser {
    /** Reads the server's reply. Null when it is not a successful answer (the app then keeps what it showed before). */
    fun parse(text: String): List<Job>? = try {
        val o = JSONObject(text)
        if (!o.optBoolean("success", false)) null
        else {
            val a = o.optJSONArray("jobs")
            if (a == null) emptyList()
            else (0 until a.length()).mapNotNull { i ->
                val j = a.optJSONObject(i) ?: return@mapNotNull null
                val provider = j.optString("provider")
                val wallet = j.optString("wallet")
                // A job without a place to send the money is not a job.
                if (provider.isBlank() || wallet.isBlank()) null
                else Job(
                    provider = provider,
                    agent = j.optString("agent", ""),
                    urgency = j.optString("urgency", "normal").let { if (it == "urgent" || it == "critical") it else "normal" },
                    balance = j.optDouble("balance", 0.0),
                    balanceAt = j.optString("balance_at", ""),
                    threshold = j.optDouble("threshold", 0.0),
                    wallet = wallet,
                    network = j.optString("network", ""),
                    instruction = j.optString("instruction", ""),
                )
            }
        }
    } catch (e: Exception) {
        null
    }
}

object JobsApi {
    private fun post(s: AppSettings, json: String): String? {
        val url = s.serverUrl
        if (url.isBlank() || s.deviceStatus != "approved") return null
        var conn: HttpURLConnection? = null
        return try {
            conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Authorization", "Device " + s.deviceKey)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode !in 200..299) null else conn.inputStream.bufferedReader().use { it.readText() }.take(20000)
        } catch (e: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }

    /** The jobs this phone has right now. Null when the server cannot be reached. */
    fun fetch(s: AppSettings): List<Job>? = post(s, """{"action":"jobs"}""")?.let { JobsParser.parse(it) }

    /** Tells the server the agent finished the job for [provider]. True when the server recorded it. */
    fun done(s: AppSettings, provider: String): Boolean {
        val body = JSONObject().put("action", "job_done").put("provider", provider).toString()
        val r = post(s, body) ?: return false
        return try { JSONObject(r).optBoolean("done", false) } catch (e: Exception) { false }
    }
}

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

/** One "I sent it" the partner submitted: the amount and P2P charge they typed, and how the check against the next Cash Out message went.
 *  [status] is "checking", "mismatch" (they may fix the numbers once, [attempts] is 1), "review" (the owner will look), "verified" or "rejected". */
data class Transfer(
    val id: String,
    val provider: String,
    val amount: Double,
    val charge: Double,
    val status: String,
    val attempts: Int,
    val submittedAt: String,
) {
    val canFix: Boolean get() = status == "mismatch" && attempts < 2
}

/** Everything the phone shows about work: the jobs open now and its recent sends. */
data class JobsSnapshot(val jobs: List<Job>, val transfers: List<Transfer>)

/** What the server said about a submitted send. [error] is null on success; [message] is wording for the partner. */
data class SendResult(val ok: Boolean, val status: String, val error: String?) {
    val message: String
        get() = when (error) {
            null -> ""
            "already_waiting" -> "The last send for this wallet is still being checked. Wait for it to turn green first."
            "too_much" -> "That is more than the wallet's balance. Check the amount and the charge."
            "no_balance" -> "PayTrace has not seen a balance message for this wallet yet."
            "bad_amount", "bad_provider" -> "Type the amount in taka, for example 10000."
            "not_fixable" -> "These numbers cannot be changed any more. The owner will check them."
            "offline" -> "Could not reach the server. Check the internet and try again."
            else -> "Could not save. Try again."
        }
}

/** Reads what the partner typed in the amount boxes: plain numbers, commas allowed, Bangla digits allowed, at most two decimals. */
object MoneyInput {
    private val shape = Regex("[0-9]{1,9}(\\.[0-9]{1,2})?")

    fun parse(text: String): Double? {
        val ascii = text.trim().map { c -> if (c in '০'..'৯') '0' + (c - '০') else c }.joinToString("")
            .replace(",", "").replace(" ", "")
        return if (shape.matches(ascii)) ascii.toDoubleOrNull() else null
    }
}

object JobsParser {
    /** The sends the partner has submitted, newest first. Empty when the reply has none (an older server) or is not a success. */
    fun parseTransfers(text: String): List<Transfer> = try {
        val o = JSONObject(text)
        val a = if (o.optBoolean("success", false)) o.optJSONArray("transfers") else null
        if (a == null) emptyList()
        else (0 until a.length()).mapNotNull { i ->
            val t = a.optJSONObject(i) ?: return@mapNotNull null
            val id = t.optString("id")
            val provider = t.optString("provider")
            val status = t.optString("status")
            if (id.isBlank() || provider.isBlank() || status.isBlank()) null
            else Transfer(id, provider, t.optDouble("amount", 0.0), t.optDouble("charge", 0.0), status, t.optInt("attempts", 1), t.optString("submitted_at", ""))
        }
    } catch (e: Exception) {
        emptyList()
    }

    /** The server's answer to "I sent it" / "fix the numbers". Null text means the phone could not reach the server. */
    fun parseSend(text: String?): SendResult {
        if (text == null) return SendResult(false, "", "offline")
        return try {
            val o = JSONObject(text)
            if (!o.optBoolean("success", false)) SendResult(false, "", "failed")
            else if (o.optBoolean("ok", false)) SendResult(true, o.optString("status", "checking"), null)
            else SendResult(false, "", o.optString("error", "failed"))
        } catch (e: Exception) {
            SendResult(false, "", "failed")
        }
    }

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

    /** The jobs this phone has right now and its recent sends. Null when the server cannot be reached. */
    fun fetch(s: AppSettings): JobsSnapshot? {
        val text = post(s, """{"action":"jobs"}""") ?: return null
        val jobs = JobsParser.parse(text) ?: return null
        return JobsSnapshot(jobs, JobsParser.parseTransfers(text))
    }

    /** The partner says they sent [amount] with P2P [charge]; the next Cash Out message for this wallet will check it. */
    fun sent(s: AppSettings, provider: String, amount: Double, charge: Double): SendResult {
        val body = JSONObject().put("action", "job_sent").put("provider", provider).put("amount", amount).put("charge", charge).toString()
        return JobsParser.parseSend(post(s, body))
    }

    /** The one correction allowed after a send did not add up. */
    fun fix(s: AppSettings, id: String, amount: Double, charge: Double): SendResult {
        val body = JSONObject().put("action", "job_fix").put("id", id).put("amount", amount).put("charge", charge).toString()
        return JobsParser.parseSend(post(s, body))
    }

    /** Tells the server the agent finished the job for [provider]. True when the server recorded it. */
    fun done(s: AppSettings, provider: String): Boolean {
        val body = JSONObject().put("action", "job_done").put("provider", provider).toString()
        val r = post(s, body) ?: return false
        return try { JSONObject(r).optBoolean("done", false) } catch (e: Exception) { false }
    }
}

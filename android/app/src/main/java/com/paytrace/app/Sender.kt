package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object Sender {
    /** deviceStatus is the server's view of this phone ("pending", "approved", …) when it said so. */
    data class Result(val ok: Boolean, val error: String?, val body: String?, val deviceStatus: String? = null)

    private fun deviceStatusOf(text: String): String? = try {
        JSONObject(text).optString("device_status", "").ifEmpty { null }
    } catch (e: Exception) {
        null
    }

    /** The shared secret wins if one was typed in (older setup); otherwise this phone's own key. */
    private fun authHeader(s: AppSettings): String =
        s.secret.ifBlank { "Device " + s.deviceKey }

    /** Builds the request body from the user's chosen fields. Locked fields are always included. */
    fun payload(s: AppSettings, r: LogRow): JSONObject {
        val f = s.fields + AppSettings.LOCKED
        val o = JSONObject()
        fun put(key: String, value: Any?) {
            if (key in f && value != null) o.put(key, value)
        }
        put("platform", r.provider)
        put("trx_id", r.trxId)
        put("amount", r.amount)
        put("sender", r.payer)
        put("fee", r.fee)
        put("commission", r.commission)
        put("balance", r.balance)
        put("datetime", r.datetime)
        put("raw_message", r.body)
        put("sender_id", r.sender)
        put("timestamp", r.createdAt)
        return o
    }

    private fun withQuery(url: String, o: JSONObject): String {
        val sb = StringBuilder(url)
        sb.append(if (url.contains("?")) "&" else "?")
        val it = o.keys()
        var first = true
        while (it.hasNext()) {
            val k = it.next()
            if (!first) sb.append("&")
            first = false
            sb.append(URLEncoder.encode(k, "UTF-8")).append("=")
                .append(URLEncoder.encode(o.get(k).toString(), "UTF-8"))
        }
        return sb.toString()
    }

    /** Success means: HTTP 2xx AND the body says {"success": true}. Anything else is a failure to retry. */
    fun send(s: AppSettings, o: JSONObject): Result {
        val url = s.serverUrl
        if (url.isBlank()) return Result(false, "Server URL is not set", null)
        var conn: HttpURLConnection? = null
        try {
            val get = s.method == "GET"
            conn = URL(if (get) withQuery(url, o) else url).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            conn.requestMethod = if (get) "GET" else "POST"
            conn.setRequestProperty("Authorization", authHeader(s))
            conn.setRequestProperty("Accept", "application/json")
            if (!get) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(o.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }?.take(3000) ?: ""
            val dev = deviceStatusOf(text)
            if (dev != null && s.secret.isBlank()) s.deviceStatus = if (dev == "unknown") "unpaired" else dev
            if (code !in 200..299) return Result(false, "HTTP $code", text, dev)
            val ok = try { JSONObject(text).optBoolean("success", false) } catch (e: Exception) { false }
            return if (ok) Result(true, null, text, dev) else Result(false, "Server did not confirm success", text, dev)
        } catch (e: Exception) {
            return Result(false, e.javaClass.simpleName + ": " + (e.message ?: ""), null)
        } finally {
            conn?.disconnect()
        }
    }

    /** "I am alive", plus what this phone can see about itself. The server shows it on the Devices page and
     *  alerts the owner if payments cannot be captured (monitoring off, SMS permission off). */
    fun heartbeat(ctx: Context, s: AppSettings): JSONObject {
        val o = JSONObject().put("action", "heartbeat")
        o.put("monitoring", s.monitoring)
        o.put("sms_permission", ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED)
        o.put("inbox_permission", ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED)
        o.put("recovered", s.recoveredTotal)
        o.put("stopped_count", s.stoppedCount)
        o.put("default_sms", DefaultSms.isDefault(ctx))
        o.put("last_gap_min", s.lastGapMin)
        o.put("notifications", Setup.notificationsOn(ctx))
        o.put("battery_exempt", Setup.batteryExempt(ctx))
        o.put("setup_complete", Setup.missing(ctx, s).isEmpty())
        o.put("push_ready", s.pushToken.isNotEmpty())
        o.put("wake_count", s.wakeCount)
        if (s.lastWakeAt > 0) o.put("last_wake_at", s.lastWakeAt)
        val now = System.currentTimeMillis()
        if (PushPolicy.shouldSend(s.pushToken, s.pushSentToken, s.pushSentAt, now)) {
            o.put("push_token", s.pushToken)
            s.pushSentToken = s.pushToken
            s.pushSentAt = now
        }
        try {
            val (pending, failed) = Db.get(ctx).backlog()
            o.put("pending", pending).put("failed", failed)
        } catch (e: Exception) {
            // The counts are optional; a heartbeat without them still proves the phone is alive.
        }
        try {
            val battery = (ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager)
                ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (battery != null && battery in 0..100) o.put("battery", battery)
        } catch (e: Exception) {
        }
        try {
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName?.let { o.put("app_version", it) }
        } catch (e: Exception) {
        }
        return o
    }

    /** Asks the server to add this phone. Nothing is trusted until an admin approves the code in the dashboard. */
    fun pair(s: AppSettings): Result {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(s.serverUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 20000
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            val o = JSONObject().put("action", "pair").put("token_hash", s.deviceKeyHash).put("name", s.deviceName)
            conn.outputStream.use { it.write(o.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }?.take(500) ?: ""
            val dev = deviceStatusOf(text)
            if (dev != null) s.deviceStatus = dev
            return if (code in 200..299 && dev != null) Result(true, null, text, dev) else Result(false, "HTTP $code", text, dev)
        } catch (e: Exception) {
            return Result(false, e.javaClass.simpleName + ": " + (e.message ?: ""), null)
        } finally {
            conn?.disconnect()
        }
    }

    /** Sends a clearly-marked test that the server acknowledges without storing anything. */
    fun test(s: AppSettings): Result {
        val o = JSONObject()
            .put("test", true)
            .put("platform", "BKASH")
            .put("trx_id", "TEST" + (100000..999999).random())
            .put("amount", (100..5000).random().toDouble())
            .put("raw_message", "PayTrace connection test")
            .put("sender_id", "bKash")
            .put("timestamp", System.currentTimeMillis())
        return send(s, o)
    }
}

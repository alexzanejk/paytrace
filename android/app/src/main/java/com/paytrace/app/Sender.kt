package com.paytrace.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

object Sender {
    data class Result(val ok: Boolean, val error: String?, val body: String?)

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
            conn.setRequestProperty("Authorization", s.secret)
            conn.setRequestProperty("Accept", "application/json")
            if (!get) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(o.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }?.take(500) ?: ""
            if (code !in 200..299) return Result(false, "HTTP $code", text)
            val ok = try { JSONObject(text).optBoolean("success", false) } catch (e: Exception) { false }
            return if (ok) Result(true, null, text) else Result(false, "Server did not confirm success", text)
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

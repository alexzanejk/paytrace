package com.paytrace.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.LocalDate
import java.util.Locale

/** What a partner's own phone shows about what they earned. The server only answers when the owner switched "show earnings" on for
 *  this phone in the dashboard; otherwise [enabled] is false and the app shows nothing. PayTrace only records this: the owner pays
 *  partners outside the app. */
data class EarnTotals(val total: Double, val commission: Double)
data class EarnDay(val day: String, val total: Double, val commission: Double)
data class EarnLine(val provider: String, val kind: String, val total: Double, val rate: Double, val commission: Double)
data class EarnRate(val provider: String, val kind: String, val rate: Double)

data class Earnings(
    val enabled: Boolean,
    val name: String = "",
    val day: String = "",
    val today: EarnTotals = EarnTotals(0.0, 0.0),
    val todayDetail: List<EarnLine> = emptyList(),
    val month: EarnTotals = EarnTotals(0.0, 0.0),
    val days: List<EarnDay> = emptyList(),
    val rates: List<EarnRate> = emptyList(),
    val earned: Double = 0.0,
    val paid: Double = 0.0,
    val owed: Double = 0.0,
)

object EarningsParser {
    private fun totals(o: JSONObject?) = EarnTotals(o?.optDouble("total", 0.0) ?: 0.0, o?.optDouble("commission", 0.0) ?: 0.0)

    private fun <T : Any> list(a: JSONArray?, f: (JSONObject) -> T): List<T> =
        if (a == null) emptyList() else (0 until a.length()).mapNotNull { i -> a.optJSONObject(i)?.let(f) }

    /** Reads the server's reply. Null when it is not a successful answer (the app then keeps what it showed before). */
    fun parse(text: String): Earnings? = try {
        val o = JSONObject(text)
        if (!o.optBoolean("success", false)) null
        else if (!o.optBoolean("enabled", false)) Earnings(enabled = false)
        else Earnings(
            enabled = true,
            name = o.optString("name", ""),
            day = o.optString("day", ""),
            today = totals(o.optJSONObject("today")),
            todayDetail = list(o.optJSONArray("today_detail")) {
                EarnLine(it.optString("provider"), it.optString("kind"), it.optDouble("total", 0.0), it.optDouble("rate", 0.0), it.optDouble("commission", 0.0))
            },
            month = totals(o.optJSONObject("month")),
            days = list(o.optJSONArray("days")) { EarnDay(it.optString("day"), it.optDouble("total", 0.0), it.optDouble("commission", 0.0)) },
            rates = list(o.optJSONArray("rates")) { EarnRate(it.optString("provider"), it.optString("kind"), it.optDouble("rate", 0.0)) },
            earned = o.optDouble("earned", 0.0),
            paid = o.optDouble("paid", 0.0),
            owed = o.optDouble("owed", 0.0),
        )
    } catch (e: Exception) {
        null
    }
}

/** Plain-language text for the Earnings card. Pure, so it is unit tested. */
object EarningsFormat {
    private val symbols = DecimalFormatSymbols(Locale.US)

    /** "Tk 1,234.50" */
    fun money(n: Double): String = "Tk " + DecimalFormat("#,##0.00", symbols).format(n)

    /** "4%" or "4.5%" */
    fun pct(n: Double): String = DecimalFormat("0.##", symbols).format(n) + "%"

    fun provider(p: String): String = when (p) {
        "bkash" -> "bKash"
        "nagad" -> "Nagad"
        "rocket" -> "Rocket"
        "upay" -> "Upay"
        else -> p
    }

    fun kind(k: String): String = when (k) {
        "cash_out" -> "Cash Out"
        "send_money" -> "Send Money"
        else -> k
    }

    /** "Fri 23 Oct" for 2026-10-23; the text unchanged if it is not a date. */
    fun dayLabel(day: String): String = try {
        val d = LocalDate.parse(day)
        val dow = d.dayOfWeek.name.take(3).lowercase().replaceFirstChar { it.uppercase() }
        val mon = d.month.name.take(3).lowercase().replaceFirstChar { it.uppercase() }
        "$dow ${d.dayOfMonth} $mon"
    } catch (e: Exception) {
        day
    }

    /** "bKash Cash Out 5%" */
    fun rateLine(r: EarnRate): String = provider(r.provider) + " " + kind(r.kind) + " " + pct(r.rate)

    /** "Tk 4,000.00 at 5% = Tk 200.00" */
    fun line(l: EarnLine): String = money(l.total) + " at " + pct(l.rate) + " = " + money(l.commission)
}

object EarningsApi {
    /** Asks the server for this phone's earnings. Null when it cannot be reached or the answer is not usable. */
    fun fetch(s: AppSettings): Earnings? {
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
            conn.outputStream.use { it.write("""{"action":"earnings"}""".toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode !in 200..299) null
            else EarningsParser.parse(conn.inputStream.bufferedReader().use { it.readText() }.take(20000))
        } catch (e: Exception) {
            null
        } finally {
            conn?.disconnect()
        }
    }
}

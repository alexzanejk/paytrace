package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Reading the Nagad AGENT app ("নগদ উদ্যোক্তা", launcher name "Uddokta"), from the owner's screen video of 2026-11-11
 *  (a Xiaomi, Bangla screens). Pure, so every rule is unit tested.
 *
 *  What the video showed:
 *  - Sign in: "মোবাইল নাম্বার" (filled in), "নগদ পিন" (a real password box, 4 digits), "সাইন ইন" → "সাইন ইন হচ্ছে" →
 *    "সাইন ইন সফল", then Home.
 *  - Home: "নগদ উদ্যোক্তা", the shop's name, a pill "ব্যালেন্স জানতে ট্যাপ করুন" that turns into "10,019.75 টাকা", tiles
 *    ক্যাশ ইন / বিটুবি / নিবন্ধন / বিল পে / ইএমআই পেমেন্ট / লিমিট, a menu button (☰) top left and a bell top right.
 *  - Menu: রিকুইজিশন, প্রাপ্তি স্বীকার, পেন্ডিং কেওয়াইসি তালিকা, কেওয়াইসি গ্রহণ, বিবরণী, এসটিআর/এসএআর, সেটিংস, সাইন আউট.
 *  - বিবরণী: tabs লিমিট (opens first) / লেনদেন / লেনদেন সারসংক্ষেপ / সর্বমোট নিবন্ধন. লেনদেন has two date boxes, a search
 *    box "মোবাইল নম্বর / ট্রানজ্যাকশন আইডি দিয়ে খুঁজুন" and the list, newest first: a title (ক্যাশ ইন, ক্যাশ ইন কমিশন,
 *    বিটুবি প্রাপ্ত, বিটুবি প্রেরিত), a masked number "017****5537" (or, on a commission row, "#76AOTUC5" = the TrxID of the
 *    transaction it belongs to), "৳ 400" with NO sign (the arrow icon and colour show the direction, so the title decides
 *    it here), and "আজ, 02:33 AM" / "গতকাল, 05:15 PM" / "নভে 8, 05:18 PM" (no year). A row opens a box with একাউন্ট নং,
 *    পরিমাণ, ট্রানজেকশন আইডি, দিন ও সময়. The search finds a TrxID ("76AOTUC5" brought the Cash In and its commission row).
 *  - Cash In: ONE form (একাউন্ট নং, পরিমাণ, পিন, সাবমিট), then a sheet "ক্যাশ ইন / আপনি কি নিম্নলিখিত তথ্য অনুসারে ক্যাশ ইন
 *    করতে চান? / পরিমাণ: 100 টাকা / প্রাপক: 01618-749601 / না / হ্যাঁ", then "ক্যাশ ইন ট্রান্সফার হচ্ছে" and "ক্যাশ ইন সফল /
 *    প্রাপক: 01618-749601 / ট্রানজেকশন আইডি 76AUL8CI / পরিমাণ 100 টাকা / ফি 0 টাকা / কমিশন 0.41 টাকা / বর্তমান ব্যালেন্স
 *    9,920.16 টাকা / পরবর্তী". The money moves on "হ্যাঁ". */
object NagadRead {
    const val APP = "nagad"
    /** The CUSTOMER Nagad app; never driven unless its launcher name says it is the agent app. */
    const val CUSTOMER_APP = "com.konasl.nagad"
    private const val BN = "০১২৩৪৫৬৭৮৯"
    val DHAKA: ZoneId = ZoneId.of("Asia/Dhaka")

    fun latin(s: String): String = s.map { c -> BN.indexOf(c).let { if (it >= 0) ('0' + it) else c } }.joinToString("")
    fun lc(s: String?): String = Normalizer.normalize((s ?: "").trim(), Normalizer.Form.NFC).lowercase(Locale.ROOT)

    fun isNagad(pkg: String?): Boolean = lc(pkg).let { "nagad" in it || "uddokta" in it }

    /** The agent app among the launcher's apps ([apps] = package to launcher name). The customer app is left out unless
     *  its name says "Uddokta"; a package or name with "uddokta" or "agent" wins. */
    fun pickPackage(apps: List<Pair<String, String>>): String? {
        fun named(l: String) = "uddokta" in lc(l) || "উদ্যোক্তা" in lc(l)
        val c = apps.filter { (p, l) -> isNagad(p) || named(l) }.filter { (p, l) -> p != CUSTOMER_APP || named(l) }
        return (c.firstOrNull { (p, l) -> named(l) || "uddokta" in lc(p) || "agent" in lc(p) } ?: c.firstOrNull())?.first
    }

    private val ROW_AMOUNT = Regex("^৳\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)$")
    private val TAKA = Regex("^([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:টাকা|tk\\.?|taka|bdt)$", RegexOption.IGNORE_CASE)

    /** "৳ 400", "৳1,900" → 400.0 / 1900.0; anything else null. */
    fun rowAmount(s: String?): Double? = ROW_AMOUNT.matchEntire(latin(s ?: "").trim())?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

    private val PLAIN = Regex("^(?:৳\\s*)?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)$")

    /** The list's amount_tv as the app really shows it (recording 2026-11-12): "5,000", "2.05", "500" with the ৳ drawn as
     *  a picture beside it; "৳ 400" is accepted too. */
    fun plainAmount(s: String?): Double? = PLAIN.matchEntire(latin(s ?: "").trim())?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

    /** "10,019.75 টাকা", "100 টাকা" → the number; anything else null. */
    fun takaAmount(s: String?): Double? = TAKA.matchEntire(latin(s ?: "").trim())?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()

    private val MONTHS = listOf(
        "জানুয়ারি" to 1, "জানু" to 1, "ফেব্রুয়ারি" to 2, "ফেব্রু" to 2, "ফেব" to 2, "মার্চ" to 3, "এপ্রিল" to 4, "এপ্রি" to 4,
        "মে" to 5, "জুন" to 6, "জুলাই" to 7, "জুলা" to 7, "আগস্ট" to 8, "আগ" to 8, "সেপ্টেম্বর" to 9, "সেপ্টে" to 9,
        "অক্টোবর" to 10, "অক্টো" to 10, "নভেম্বর" to 11, "নভে" to 11, "ডিসেম্বর" to 12, "ডিসে" to 12,
        "jan" to 1, "feb" to 2, "mar" to 3, "apr" to 4, "may" to 5, "jun" to 6, "jul" to 7, "aug" to 8, "sep" to 9,
        "oct" to 10, "nov" to 11, "dec" to 12,
    ).map { lc(it.first) to it.second }

    fun monthOf(s: String): Int? {
        val t = lc(s).trimEnd('.')
        return MONTHS.firstOrNull { t == it.first }?.second ?: MONTHS.filter { t.startsWith(it.first) }.maxByOrNull { it.first.length }?.second
    }

    /** The day a row names: আজ (today), গতকাল (yesterday) or "নভে 8" with no year, which is the latest such day not after
     *  tomorrow (so a list read on 2 January still puts "ডিসে 31" in the old year). */
    fun dayOf(s: String, today: LocalDate): LocalDate? {
        val l = lc(s).trimEnd(',').trim()
        if (l == "আজ" || l == "today") return today
        if (l == "গতকাল" || l == "yesterday") return today.minusDays(1)
        val m = Regex("^(\\S+)\\s+(\\d{1,2})$").matchEntire(latin(l)) ?: return null
        val mon = monthOf(m.groupValues[1]) ?: return null
        val d = m.groupValues[2].toInt()
        for (y in listOf(today.year, today.year - 1)) {
            val date = try { LocalDate.of(y, mon, d) } catch (e: Exception) { null } ?: continue
            if (!date.isAfter(today.plusDays(1))) return date
        }
        return null
    }

    private val WHEN = Regex("^(.+?),?\\s+(\\d{1,2}):(\\d{2})\\s*([ap]m)$", RegexOption.IGNORE_CASE)

    /** Epoch ms of a row's time ("আজ, 02:33 AM", "নভে 8, 05:18 PM"), Bangladesh time; null when it is not one. */
    fun timeOf(s: String?, today: LocalDate): Long? {
        val t = latin(s ?: "").trim().replace(Regex("\\s+"), " ")
        val m = WHEN.matchEntire(t) ?: return null
        val date = dayOf(m.groupValues[1], today) ?: return null
        var h = m.groupValues[2].toInt()
        val mi = m.groupValues[3].toInt()
        if (h !in 1..12 || mi !in 0..59) return null
        if (h == 12) h = 0
        if (m.groupValues[4].equals("pm", ignoreCase = true)) h += 12
        return date.atTime(h, mi).atZone(DHAKA).toInstant().toEpochMilli()
    }

    /** Which way the money went, from the row's title (the list shows no sign). Null = a kind PayTrace does not know, and
     *  such a row is not sent rather than guessed. A commission row belongs to the transaction just before it. */
    data class Kind(val incoming: Boolean?, val commission: Boolean)
    fun kindOf(title: String): Kind {
        val t = lc(title)
        if ("কমিশন" in t || "commission" in t) return Kind(true, true)
        val b2b = "বিটুবি" in t || "b2b" in t
        val inc = when {
            "ক্যাশ আউট" in t || "cash out" in t || "cashout" in t -> true
            "ক্যাশ ইন" in t || "cash in" in t || "cashin" in t -> false
            b2b && ("প্রাপ্ত" in t || "গৃহীত" in t || "received" in t) -> true
            b2b && ("প্রেরিত" in t || "sent" in t) -> false
            "বিল" in t || "bill" in t || "ইএমআই" in t || "emi" in t || "ডিপিএস" in t || "dps" in t || t == "ফি" || t == "fee" -> false
            else -> null
        }
        return Kind(inc, false)
    }

    /** "017****5537" → "017XXXX5537" (Nagad hides the middle four); a full number is hidden the same way. */
    fun party(s: String?): String? {
        val t = latin(s ?: "").trim().replace(" ", "").replace("-", "")
        Regex("^(01\\d)\\*{4}(\\d{4})$").matchEntire(t)?.let { return it.groupValues[1] + "XXXX" + it.groupValues[2] }
        Regex("^(?:\\+?88)?(01\\d{9})$").matchEntire(t)?.let { val n = it.groupValues[1]; return n.take(3) + "XXXX" + n.takeLast(4) }
        return null
    }

    /** A commission row's "#76AOTUC5": the TrxID of the transaction it belongs to. */
    fun trxOf(s: String?): String? = Regex("^#\\s*([A-Za-z0-9]{6,24})$").matchEntire((s ?: "").trim())?.groupValues?.get(1)?.uppercase(Locale.ROOT)

    fun digits(s: String?): String = latin(s ?: "").filter { it.isDigit() }.let { if (it.length == 13 && it.startsWith("880")) "0" + it.drop(3) else it }

    data class Row(
        val title: String, val party: String?, val trx: String?, val amount: Double, val at: Long, val kind: Kind,
        val commission: Double? = null,
    )

    /** One row from its words (title, number or #TrxID, "৳ 400", "আজ, 02:33 AM"); null unless the whole row is there. */
    fun rowOf(parts: List<String>, today: LocalDate): Row? {
        if (parts.size > 8) return null
        val at = parts.firstNotNullOfOrNull { timeOf(it, today) } ?: return null
        val amount = parts.firstNotNullOfOrNull { rowAmount(it) } ?: return null
        val title = parts.firstOrNull { p ->
            timeOf(p, today) == null && rowAmount(p) == null && party(p) == null && trxOf(p) == null && p.any { it.isLetter() }
        } ?: return null
        return Row(title.trim(), parts.firstNotNullOfOrNull { party(it) }, parts.firstNotNullOfOrNull { trxOf(it) }, amount, at, kindOf(title))
    }

    /** One list row from its four named boxes (tx_type_tv, amount_tv, mobile_no_tv, time_tv); null unless the title,
     *  amount and time are all there. [sub] is a hidden number ("017****4121") or, on a commission row, "#76AWL8GA". */
    fun rowFromFields(title: String?, amount: String?, sub: String?, time: String?, today: LocalDate): Row? {
        val t = title?.trim()?.takeIf { it.isNotEmpty() && it.any { c -> c.isLetter() } } ?: return null
        val a = plainAmount(amount) ?: return null
        val at = timeOf(time, today) ?: return null
        return Row(t, party(sub), trxOf(sub), a, at, kindOf(t))
    }

    /** Nagad's own popup "Rate limit exceeded. Too many requests. Please try again after 60 seconds.": how many seconds
     *  it asks for (60 when it names none); null when this is not that popup. */
    fun rateLimit(texts: List<String>): Int? {
        val t = texts.map { latin(it) }.firstOrNull { lc(it).let { l -> "rate limit" in l || "too many request" in l } } ?: return null
        return Regex("(\\d{1,4})\\s*(?:second|sec|সেকেন্ড)", RegexOption.IGNORE_CASE).find(t)?.groupValues?.get(1)?.toIntOrNull()?.coerceIn(5, 600) ?: 60
    }

    /** The list says it has nothing ("আপনার কোন লেনদেনের তথ্য নেই"). NOT proof of anything: the same words show after a
     *  rate-limit refusal. */
    fun noRows(texts: List<String>): Boolean = texts.any { lc(it).let { l -> "লেনদেনের তথ্য নেই" in l || "no transaction" in l } }

    /** How many PIN digits a PIN box holds. The empty box shows its own label as text ("নগদ পিন", "পিন"), so anything
     *  with a letter in it counts as empty; dots or digits are counted. */
    fun pinCount(text: String?): Int {
        val t = latin(text ?: "").replace(" ", "")
        if (t.isEmpty() || t.any { it.isLetter() }) return 0
        return t.count { it.isDigit() || it == '•' || it == '*' || it == '●' || it == '·' }
    }

    /** Commission rows folded into their transaction: the nearest earlier row in the list (newest first) of the same
     *  minute whose title is the commission row's without "কমিশন". It gives that transaction its commission AND its TrxID.
     *  A commission row with no such neighbour is left out. */
    fun fold(rows: List<Row>): List<Row> {
        val out = ArrayList<Row>()
        for (r in rows) {
            if (!r.kind.commission) { out.add(r); continue }
            val base = lc(r.title).replace("কমিশন", "").replace("commission", "").trim()
            val i = out.indexOfLast { it.at == r.at && it.commission == null && (base.isEmpty() || lc(it.title) == base) }
            if (i >= 0) out[i] = out[i].copy(commission = r.amount, trx = out[i].trx ?: r.trx)
        }
        return out
    }

    private val FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("hh:mma dd/MM/yy", Locale.US)
    fun money(v: Double): String = if (v == Math.floor(v)) String.format(Locale.US, "%.0f", v) else String.format(Locale.US, "%.2f", v)

    /** A row in the form the server already reads for the bKash app ("title | number | 02:33am 11/11/26 | - ৳400 |
     *  কমিশন: + ৳1.64"), with the sign worked out from the title. Null for a kind PayTrace does not know. */
    fun serverLine(r: Row): String? {
        val inc = r.kind.incoming ?: return null
        if (r.kind.commission) return null
        val parts = arrayListOf(r.title.replace(" | ", " / "))
        r.party?.let { parts.add(it) }
        parts.add(Instant.ofEpochMilli(r.at).atZone(DHAKA).format(FMT).lowercase(Locale.US))
        parts.add((if (inc) "+ ৳" else "- ৳") + money(r.amount))
        r.commission?.let { parts.add("কমিশন: + ৳" + money(it)) }
        return parts.joinToString(" | ")
    }

    /** "opened <minute ms> <amount> <masked number or -> <TrxID>": how the server puts a TrxID on its row (migration 086). */
    fun openedLine(r: Row): String? = r.trx?.let { "opened ${r.at} ${money(r.amount)} ${r.party ?: "-"} $it" }

    private val AMOUNT_L = setOf("পরিমাণ", "amount")
    private val TO_L = setOf("প্রাপক", "receiver", "recipient")
    val TRX_L = setOf("ট্রানজেকশন আইডি", "ট্রানজ্যাকশন আইডি", "transaction id", "trx id", "txn id").map { lc(it) }.toSet()
    private val COMM_L = setOf("কমিশন", "commission")
    private val BAL_L = setOf("বর্তমান ব্যালেন্স", "current balance").map { lc(it) }.toSet()

    /** The value after a label: "পরিমাণ: 100 টাকা" in one piece, or the label alone and the value as the next words. */
    fun colon(texts: List<String>, labels: Set<String>): String? {
        for (i in texts.indices) {
            val m = Regex("^(.+?)\\s*[:：]\\s*(.*)$").matchEntire(texts[i].trim()) ?: continue
            if (lc(m.groupValues[1]) in labels) return m.groupValues[2].ifBlank { texts.getOrNull(i + 1) }
        }
        return null
    }

    /** The words straight after a label that stands alone ("ট্রানজেকশন আইডি" then "76AUL8CI"). */
    fun after(texts: List<String>, labels: Set<String>): String? {
        val i = texts.indexOfFirst { lc(it).trimEnd(':', '：').trim() in labels }
        return if (i >= 0) texts.getOrNull(i + 1) else null
    }

    /** The confirmation sheet's amount and receiver (the only place they are shown back before "হ্যাঁ"). */
    data class Confirm(val amount: Double?, val number: String?)
    fun confirmOf(texts: List<String>): Confirm =
        Confirm(colon(texts, AMOUNT_L)?.let { takaAmount(it) }, colon(texts, TO_L)?.let { digits(it) }?.takeIf { it.isNotEmpty() })

    /** May "হ্যাঁ" be pressed: the sheet shows exactly this amount and exactly this receiver. */
    fun confirmMatches(c: Confirm, number: String, amount: Double): Boolean =
        c.number == number && c.amount != null && Math.abs(c.amount - amount) < 0.005

    data class Result(val number: String?, val trx: String?, val commission: Double?, val balance: Double?)
    fun resultOf(texts: List<String>): Result = Result(
        colon(texts, TO_L)?.let { digits(it) }?.takeIf { it.isNotEmpty() },
        after(texts, TRX_L)?.trim()?.takeIf { Regex("^[A-Za-z0-9]{6,24}$").matches(it) }?.uppercase(Locale.ROOT),
        after(texts, COMM_L)?.let { takaAmount(it) },
        after(texts, BAL_L)?.let { takaAmount(it) },
    )

    /** The balance figure the Home pill turns into ("10,019.75 টাকা"). */
    fun balanceOf(texts: List<String>): Double? = texts.firstNotNullOfOrNull { takaAmount(it) }

    /** The wallet said no after "হ্যাঁ" (nothing moved): failed, not enough money, a limit. */
    fun refused(texts: List<String>): Boolean = texts.map { lc(it) }.any { t ->
        "ব্যর্থ" in t || "অপর্যাপ্ত" in t || "পর্যাপ্ত ব্যালেন্স নেই" in t || "failed" in t || "insufficient" in t || "limit exceeded" in t || "সীমা অতিক্রম" in t
    }

    fun wrongPin(texts: List<String>): Boolean = texts.map { lc(it) }.any { t ->
        // "পিন নাম্বার ভুলে গিয়েছেন?" (forgot your PIN?) sits on every sign-in screen and is not an error.
        ("পিন" in t && (("ভুল" in t && "ভুলে" !in t) || "সঠিক নয়" in t)) || ("pin" in t && ("wrong" in t || "incorrect" in t || "invalid" in t))
    }

    enum class Screen { LIMITED, CONFIRM, RESULT, BUSY, DETAILS, PICKER, LOGIN, CASHIN, DRAWER, STATEMENT, HOME, UNKNOWN }

    /** Which screen this is, from its words ([texts]) and the hints of its typing boxes ([hints]). Order matters: a sheet or
     *  a box drawn over a page wins, and the menu (drawn over Home) is checked before the pages behind it. */
    fun screenOf(texts: List<String>, hints: List<String>): Screen {
        val all = (texts + hints).map { lc(it) }
        fun has(w: String) = all.any { lc(w) in it }
        fun exact(w: String) = all.any { it == lc(w) }
        return when {
            rateLimit(texts) != null -> Screen.LIMITED
            has("আপনি কি") && (exact("হ্যাঁ") || exact("yes")) -> Screen.CONFIRM
            has("সফল") && all.any { it in TRX_L } && (exact("পরবর্তী") || exact("next")) -> Screen.RESULT
            all.any { it.endsWith("হচ্ছে") } || exact("সাইন ইন সফল") || has("সম্পন্ন") -> Screen.BUSY
            has("দিন ও সময়") || (all.any { it in TRX_L } && has("একাউন্ট নং")) -> Screen.DETAILS
            exact("সব লেনদেন") -> Screen.PICKER
            (exact("সাইন ইন") || exact("sign in")) && (has("পিন") || has("pin")) -> Screen.LOGIN
            exact("সাবমিট") || exact("submit") -> Screen.CASHIN
            exact("সাইন আউট") || exact("sign out") -> Screen.DRAWER
            exact("বিবরণী") && (exact("লেনদেন") || exact("লিমিট")) -> Screen.STATEMENT
            has("ব্যালেন্স") || (exact("ক্যাশ ইন") && exact("বিটুবি")) -> Screen.HOME
            else -> Screen.UNKNOWN
        }
    }

    /** The statement's Transactions tab is showing: its search bar (search_bar_fl: the search box, or the filter chip that
     *  takes its place) or its list is on screen. [ids] are the screen's view ids without the package part. */
    fun onTransactions(ids: Set<String>): Boolean =
        "search_bar_fl" in ids || "search_edit_text" in ids || "transaction_log_rv" in ids || "tx_history_srl" in ids

    /** For a number search: the row's hidden number is that number (first three and last four digits). */
    fun samePhone(masked: String?, number: String): Boolean =
        masked != null && masked.length == 11 && number.length == 11 && masked.take(3) == number.take(3) && masked.takeLast(4) == number.takeLast(4)
}

/** What the Nagad app is asked to do. */
sealed class NagadTask {
    object Balance : NagadTask()
    data class Read(val cutoff: Long) : NagadTask()
    data class Search(val query: String) : NagadTask()
    data class CashIn(val order: CashInOrder) : NagadTask()
}

/** Driving the Nagad agent app for a dashboard command: balance, reading the statement list back to a cut-off, searching
 *  it for a TrxID or number, and Cash In. Same gates and human pace as the bKash app runs (AppReader). The PIN is the
 *  wallet's saved Nagad PIN (the same one the *167# menu uses), typed once into the app's own password box.
 *
 *  Money rule for Cash In (the same as every other way PayTrace sends money): the PIN is typed only on the form that
 *  shows THIS number and THIS amount, and "হ্যাঁ" is pressed only on the sheet that shows them back exactly; anything else
 *  presses "না" and nothing is sent. After "হ্যাঁ" nothing is ever pressed again or retried. */
object NagadApp {
    /** The dashboard's commands for the Nagad app (the bKash app's are appread / appsearch / apprecord). */
    const val READ_KIND = "nagadread"
    const val SEARCH_KIND = "nagadsearch"
    const val RECORD_KIND = "nagadrecord"
    val KINDS = setOf(READ_KIND, SEARCH_KIND, RECORD_KIND)

    const val RUN_MS = 150_000L
    private const val TICK_MS = 700L
    private const val STUCK_MS = 25_000L
    private const val LOGIN_WAIT_MS = 15_000L
    private const val AFTER_YES_MS = 60_000L
    private const val MAX_SWIPES = 60
    private const val MAX_ROWS = 400
    private const val PREFS = "paytrace_nagadread"
    private const val NEWEST = "newest_at"

    @Volatile internal var running = false

    fun findApp(ctx: Context): String? {
        val pm = ctx.packageManager
        val apps = try {
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .map { it.activityInfo.packageName to (it.loadLabel(pm)?.toString() ?: "") }.distinctBy { it.first }
        } catch (e: Exception) { emptyList() }
        return NagadRead.pickPackage(apps)
    }

    /** How far back the next automatic read goes (the same rule as the bKash app read). */
    fun cutoff(ctx: Context, now: Long): Long =
        AppReader.cutoff(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(NEWEST, 0L).takeIf { it > 0 }, now)

    private fun root(svc: AccessibilityService): AccessibilityNodeInfo? {
        svc.rootInActiveWindow?.let { if (NagadRead.isNagad(it.packageName?.toString())) return it }
        return try { svc.windows.mapNotNull { it.root }.firstOrNull { NagadRead.isNagad(it.packageName?.toString()) } } catch (e: Exception) { null }
    }

    /** Every node, typing boxes included (the Cash In form is three of them), in screen order. A node lying wholly left or
     *  right of the screen is skipped with everything inside it: the statement's ViewPager keeps its other tabs in the
     *  tree off screen (recording 2026-11-12: the লিমিট tab's "ক্যাশ ইন" and "৳ 1,071.01" at negative x), and they must
     *  never be read as this page. */
    private fun all(n: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>, depth: Int, width: Int = Int.MAX_VALUE) {
        if (n == null || depth > 40 || out.size > 1500) return
        if (depth > 0) {
            val r = Rect().also { n.getBoundsInScreen(it) }
            if (r.right <= 0 || r.left >= width) return
        }
        out.add(n)
        for (i in 0 until n.childCount) all(n.getChild(i), out, depth + 1, width)
    }

    /** A node's view id without the package part ("pin_input_view"). */
    private fun idOf(n: AccessibilityNodeInfo): String? = n.viewIdResourceName?.substringAfter(":id/")
    private fun byId(nodes: List<AccessibilityNodeInfo>, id: String): AccessibilityNodeInfo? = nodes.firstOrNull { idOf(it) == id }

    /** The on-screen keyboard (another app's window, reachable because the service retrieves interactive windows). */
    private fun imeNodes(svc: AccessibilityService): List<AccessibilityNodeInfo> {
        val r = try { svc.windows.firstOrNull { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }?.root } catch (e: Exception) { null } ?: return emptyList()
        return ArrayList<AccessibilityNodeInfo>().also { all(r, it, 0) }
    }

    /** The keyboard key that is exactly this digit (by its label or its spoken name; Bangla digits count), never a guess
     *  by position. */
    private fun imeKey(keys: List<AccessibilityNodeInfo>, ch: Char): AccessibilityNodeInfo? = keys.firstOrNull { n ->
        val r = Rect().also { n.getBoundsInScreen(it) }
        !r.isEmpty && (NagadRead.latin(n.text?.toString()?.trim() ?: "") == ch.toString() || NagadRead.latin(n.contentDescription?.toString()?.trim() ?: "") == ch.toString())
    }

    private val DELETE_KEY = setOf("delete", "backspace", "ডিলিট", "মুছুন", "⌫")
    private fun imeDelete(keys: List<AccessibilityNodeInfo>): AccessibilityNodeInfo? = keys.firstOrNull { n ->
        val r = Rect().also { n.getBoundsInScreen(it) }
        !r.isEmpty && (NagadRead.lc(n.contentDescription?.toString()) in DELETE_KEY || NagadRead.lc(n.text?.toString()) in DELETE_KEY)
    }

    /** Is this button lit (enabled)? Nagad greys out সাইন ইন and সাবমিট until the boxes are complete. */
    private fun enabled(n: AccessibilityNodeInfo?): Boolean? {
        var p = n
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) return p.isEnabled; p = p.parent; hops++ }
        return n?.isEnabled
    }

    private fun top(n: AccessibilityNodeInfo): Int = Rect().also { n.getBoundsInScreen(it) }.top

    private fun setText(n: AccessibilityNodeInfo, text: String): Boolean = try {
        n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        })
    } catch (e: Exception) { false }

    private fun press(svc: AccessibilityService, n: AccessibilityNodeInfo): Boolean {
        var p: AccessibilityNodeInfo? = n
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) break; p = p.parent; hops++ }
        val t = p ?: n
        return AppReader.tap(svc, t) || (try { t.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false })
    }

    private fun pressWords(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>, words: Set<String>, lowest: Boolean = false): Boolean {
        val hits = nodes.filter { !it.isEditable && NagadRead.lc(it.text?.toString()) in words }
        val hit = (if (lowest) hits.maxByOrNull { top(it) } else hits.firstOrNull()) ?: return false
        return press(svc, hit)
    }

    private val SIGN_IN = setOf("সাইন ইন", "sign in")
    private val YES = setOf("হ্যাঁ", "yes")
    private val NO = setOf("না", "no")
    private val SUBMIT = setOf("সাবমিট", "submit")
    private val NEXT = setOf("পরবর্তী", "next")
    private val CASH_IN = setOf("ক্যাশ ইন", "cash in")
    private val STATEMENT = setOf("বিবরণী", "statement")
    private val TX_TAB = setOf("লেনদেন", "transaction", "transactions")
    private val ALL_TYPES = setOf("সব লেনদেন", "all transactions")
    private val OK = setOf("ঠিক আছে", "ok")

    fun start(ctx: Context, task: NagadTask, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        fun fail(e: String) = done(UssdOutcome(false, null, e))
        if (!s.ussdAllowed) return fail("not_allowed")
        if (task is NagadTask.CashIn) {
            if (!s.cashInAllowed) return fail("cash_in_off")
            if (task.order.provider != UssdProviders.NAGAD || !task.order.sane()) return fail("bad_cash_in")
        }
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (running || AppReader.active() || UssdSession.active() || UssdApi.active()) return fail("busy")
        val pin = UssdSetup.pinStore(app, UssdProviders.NAGAD).get().trim()
        if (!Regex("^\\d{4,6}$").matches(pin)) return fail("no_pin")
        val pkg = findApp(app) ?: return fail("no_nagad_app")
        val woke = when (ScreenWake.state(app)) {
            ScreenGate.State.LOCKED_SECURE -> return fail("phone_locked")
            ScreenGate.State.WAKE_NEEDED -> true
            ScreenGate.State.READY -> false
        }
        running = true
        val pace = AppReader.pace
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        val today = LocalDate.now(NagadRead.DHAKA)
        val trace = ArrayList<String>()
        fun note(t: String) { if (trace.size < 50) trace.add(String.format(Locale.US, "%5.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, t)) }

        var finished = false
        var seenApp = 0L
        var leftAt = 0L
        var relaunches = 0
        var nextActAt = 0L
        var progressAt = started
        var screenText = ""
        var backs = 0
        var sawWalletError = false
        var reopens = 0
        // sign in: Nagad's PIN box is its own drawing over a plain text box, so the PIN is typed one way after another
        // until the app itself lights সাইন ইন (it stays grey until it holds the whole PIN), and only then pressed.
        var pinWay = 0; var pinCheckAt = 0L; var loginAt = 0L
        var keysMissing = false; var keyNoted = false
        // what happened after সাইন ইন was pressed: each new screen and any toast, so a failed sign-in explains itself
        var signedIn = false; var lastTrail = ""; var trailNotes = 0; var loginWall = 0L; val toastSeen = HashSet<String>()
        val width = svc.resources.displayMetrics.widthPixels
        // Nagad's "too many requests" popup
        var limitHits = 0; var limitSeen = false
        // a filter or a search left on the list by someone
        var chipRemovals = 0; var searchCleared = false; var retryTaps = 0; var emptyAt = 0L
        // menu / statement
        var drawerTries = 0; var tabPresses = 0
        // reading
        val seen = LinkedHashMap<String, NagadRead.Row>()
        val nodeOf = HashMap<String, AccessibilityNodeInfo>()
        var lastKeys = emptySet<String>()
        var swipes = 0; var stale = 0; var backSwipes = 0
        // balance
        var pillTaps = 0; var pillAt = 0L; var homeAt = 0L
        // search
        var sStage = 0; var sTypes = 0; var sWays = 0; var sAt = 0L
        val toOpen = ArrayList<String>(); var openKey: String? = null; var openAt = 0L
        val sheetTrx = HashMap<String, String>()
        var outcome = ""
        // cash in
        var cStage = 0; var cTypes = 0; var submits = 0; var submitAt = 0L
        var cPinWay = 0; var cPinCheckAt = 0L
        var yesAt = 0L

        fun finish(o: UssdOutcome, why: String) {
            if (finished) return
            finished = true
            running = false
            note("end: $why")
            done(o.copy(trace = (trace + "screen: $screenText").joinToString("\n").take(1900)))
            main.postDelayed({ try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { } }, pace.readPause())
        }
        fun stop(error: String, why: String) = finish(UssdOutcome(false, null, error), why)

        /** Types [text] on the on-screen keyboard, one key at a time, each key found again just before it is pressed
         *  (after [deletes] presses of its delete key, which empties the box). Every press first checks that the box
         *  with the keyboard's focus IS this box, so a PIN can never land in the amount or number box. Returns how long
         *  it takes. */
        fun typeKeys(box: AccessibilityNodeInfo, text: String, deletes: Int): Long {
            val want = idOf(box)
            try { box.performAction(AccessibilityNodeInfo.ACTION_FOCUS) } catch (e: Exception) { }
            press(svc, box)
            fun focusHere(): Boolean {
                val f = try { svc.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) } catch (e: Exception) { null } ?: return false
                return if (want != null) idOf(f) == want else f == box
            }
            var at = 1_300L
            repeat(deletes) {
                main.postDelayed({ if (!finished && focusHere()) imeDelete(imeNodes(svc))?.let { AppReader.tap(svc, it) } }, at)
                at += 160L
            }
            at += 400L
            for (ch in text) {
                main.postDelayed({
                    if (finished) return@postDelayed
                    val keys = imeNodes(svc)
                    val key = imeKey(keys, ch)
                    val here = focusHere()
                    if (!keyNoted) {
                        keyNoted = true
                        val f = try { svc.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) } catch (e: Exception) { null }
                        note("keyboard: ${if (keys.isEmpty()) "not on screen" else "${keys.size} parts"}, the key ${if (key == null) "NOT found" else "found"}, typing focus on ${f?.let { idOf(it) ?: it.className } ?: "nothing"}")
                    }
                    if (!here) { keysMissing = true; return@postDelayed }
                    if (key == null) keysMissing = true else AppReader.tap(svc, key)
                }, at)
                at += pace.keyGap() + 200L
            }
            return at
        }

        /** Puts [text] into the box through Android's own "set text", emptying it first; [stepwise] = a growing text,
         *  as if typed. Returns how long it takes. */
        fun typeSet(box: AccessibilityNodeInfo, text: String, stepwise: Boolean): Long {
            press(svc, box)
            var at = pace.keyGap()
            main.postDelayed({ setText(box, "") }, at)
            at += pace.keyGap()
            if (stepwise) {
                for (i in 1..text.length) { val part = text.take(i); main.postDelayed({ setText(box, part) }, at); at += pace.charGap() }
            } else {
                main.postDelayed({ setText(box, text) }, at); at += pace.keyGap()
            }
            return at
        }

        val pinWays = listOf("on the keyboard, key by key", "all at once", "one digit at a time")
        /** One way of putting the PIN into a PIN box (the keyboard first: it is what a person does). */
        fun typePin(box: AccessibilityNodeInfo, way: Int): Long {
            keysMissing = false
            return when (way) {
                0 -> typeKeys(box, pin, 6)
                1 -> typeSet(box, pin, false)
                else -> typeSet(box, pin, true)
            }
        }

        fun rowsOn(nodes: List<AccessibilityNodeInfo>): List<Pair<String, NagadRead.Row>> {
            val out = ArrayList<Pair<String, NagadRead.Row>>()
            // By the list's own boxes (recording 2026-11-12): each row holds tx_type_tv, amount_tv ("5,000", no ৳),
            // mobile_no_tv ("013****7088" or "#76AWL8GA") and time_tv ("গতকাল, 07:03 PM").
            for (t in nodes.filter { idOf(it) == "tx_type_tv" }) {
                val rowNode = t.parent ?: continue
                val inner = ArrayList<AccessibilityNodeInfo>().also { all(rowNode, it, 0, width) }
                fun f(id: String) = inner.firstOrNull { idOf(it) == id }?.text?.toString()?.trim()
                val title = t.text?.toString()?.trim()
                val amount = f("amount_tv"); val sub = f("mobile_no_tv"); val time = f("time_tv")
                val row = NagadRead.rowFromFields(title, amount, sub, time, today) ?: continue
                val key = listOf(title, sub, time, amount).joinToString(" | ")
                if (out.none { it.first == key }) { out.add(key to row); nodeOf[key] = rowNode }
            }
            if (out.isNotEmpty() || nodes.any { idOf(it) == "transaction_log_rv" }) return out
            // Fallback for a version of the app without those names: words around a "৳ 400".
            val used = HashSet<AccessibilityNodeInfo>()
            for (n in nodes) {
                if (n.isEditable || NagadRead.rowAmount(n.text?.toString()) == null) continue
                var p: AccessibilityNodeInfo? = n.parent
                var hops = 0
                while (p != null && hops < 4) {
                    val parts = ArrayList<String>()
                    AppReader.words(p, parts, 0)
                    val row = NagadRead.rowOf(parts, today)
                    if (row != null) {
                        if (used.add(p)) {
                            val key = parts.joinToString(" | ")
                            out.add(key to row)
                            nodeOf[key] = p
                        }
                        break
                    }
                    if (parts.size > 8) break
                    p = p.parent; hops++
                }
            }
            return out
        }

        /** The rows read so far, each with the TrxID its opened box showed, commission rows folded in. */
        fun merged(): List<NagadRead.Row> =
            NagadRead.fold(seen.entries.map { (k, r) -> sheetTrx[k]?.let { r.copy(trx = r.trx ?: it) } ?: r })

        fun readOutcome(header: String): UssdOutcome {
            val withTrx = merged()
            val lines = withTrx.mapNotNull { NagadRead.serverLine(it) }
            val opened = withTrx.mapNotNull { NagadRead.openedLine(it) }.take(20)
            val oldest = withTrx.minOfOrNull { it.at }
            val head = header + (if (oldest != null) "\noldest: $oldest" else "")
            return UssdOutcome(true, null, null, screens = AppReader.pack(head, lines, trace.joinToString("\n"), opened))
        }

        fun finishRead(why: String) {
            val newest = seen.values.maxOfOrNull { it.at }
            if (newest != null) app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putLong(NEWEST, newest).apply()
            note("read ${seen.size} rows")
            finish(readOutcome("Nagad app read\npackage: $pkg"), why)
        }

        fun finishSearch(q: String, why: String) {
            val rows = merged()
            val hits = if (Regex("^01\\d{9}$").matches(q)) rows.filter { NagadRead.samePhone(it.party, q) } else rows.filter { it.trx == q }
            if (outcome.isEmpty()) outcome = if (hits.isNotEmpty()) "found" else "nothing found"
            val summary = (listOf("Nagad app search", "query: $q", "outcome: $outcome") +
                hits.take(8).map { r -> "row: " + listOfNotNull(r.title, r.party, Instant.ofEpochMilli(r.at).atZone(NagadRead.DHAKA).format(DateTimeFormatter.ofPattern("hh:mm a dd/MM/yy", Locale.US)), "৳" + NagadRead.money(r.amount), r.trx).joinToString(" · ") })
                .joinToString("\n")
            val base = readOutcome(summary.take(1800))
            finish(base, why)
        }

        AppReader.holdScreen(app, RUN_MS + 5_000, "nagad")

        val tick = object : Runnable {
            override fun run() {
                if (finished) return
                val now = SystemClock.elapsedRealtime()
                if (now - started > RUN_MS) {
                    return when {
                        task is NagadTask.CashIn && yesAt > 0 -> stop("no_answer_after_confirm", "time limit after হ্যাঁ: not known if it went through")
                        task is NagadTask.Read && seen.isNotEmpty() -> finishRead("time limit")
                        task is NagadTask.Search -> finishSearch(task.query, "time limit")
                        else -> stop("app_closed", "time limit")
                    }
                }
                try {
                    val r = root(svc)
                    if (r == null) {
                        if (seenApp == 0L && OpenRetry.due(false, now - started, reopens)) { reopens++; note("the Nagad app is not on screen yet: opening it again ($reopens)"); AppReader.openBkash(svc, app, pkg, woke) { note(it) } }
                        if (seenApp == 0L && now - started > OpenRetry.GIVE_UP_MS) return stop("app_not_opened", "the Nagad app did not open")
                        if (seenApp > 0) {
                            if (leftAt == 0L) leftAt = now
                            if (now - leftAt > 3_000 && yesAt == 0L) {
                                if (relaunches >= 3) return stop("app_closed", "the Nagad app kept leaving the screen")
                                relaunches++; leftAt = 0L
                                note("the Nagad app left the screen: opening it again ($relaunches)")
                                AppReader.openBkash(svc, app, pkg, false) { note(it) }
                                nextActAt = now + pace.settle()
                            } else if (yesAt > 0 && now - yesAt > AFTER_YES_MS) {
                                return stop("no_answer_after_confirm", "the app left the screen after হ্যাঁ")
                            }
                        }
                        main.postDelayed(this, TICK_MS); return
                    }
                    leftAt = 0L
                    if (seenApp == 0L) nextActAt = now + pace.settle()
                    seenApp = now
                    val nodes = ArrayList<AccessibilityNodeInfo>()
                    all(r, nodes, 0, width)
                    val ids = nodes.mapNotNull { idOf(it) }.toSet()
                    val texts = nodes.filter { !it.isEditable && !it.isPassword }.mapNotNull { it.text?.toString()?.trim()?.takeIf { t -> t.isNotEmpty() } }
                    val boxes = nodes.filter { it.isEditable || it.isPassword }.sortedBy { top(it) }
                    val hints = boxes.mapNotNull { b -> (if (Build.VERSION.SDK_INT >= 26) b.hintText?.toString() else null) }
                    screenText = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                    val canAct = now >= nextActAt
                    val screen = NagadRead.screenOf(texts, hints)

                    // After "হ্যাঁ" only the answer is read; nothing is pressed again but "পরবর্তী" on the result.
                    if (task is NagadTask.CashIn && yesAt > 0) {
                        when {
                            screen == NagadRead.Screen.RESULT -> {
                                val res = NagadRead.resultOf(texts)
                                note("Nagad says the Cash In went through" + (res.trx?.let { ", TrxID $it" } ?: ""))
                                if (res.number != null && res.number != task.order.number) note("NOTE: the receipt names ${res.number}, not ${task.order.number}")
                                main.postDelayed({ pressWords(svc, nodes, NEXT) }, pace.readPause())
                                val summary = "Nagad app Cash In\nto: ${res.number ?: "?"}\namount: ${NagadRead.money(task.order.amount)}\ntrx: ${res.trx ?: "?"}\nbalance: ${res.balance ?: "?"}\ncommission: ${res.commission ?: "?"}"
                                return finish(UssdOutcome(true, res.balance, null, trx = res.trx, screens = listOf(summary)), "done")
                            }
                            NagadRead.refused(texts) -> return stop("wallet_refused", "Nagad refused the Cash In")
                            now - yesAt > AFTER_YES_MS -> return stop("no_answer_after_confirm", "no receipt ${AFTER_YES_MS / 1000}s after হ্যাঁ: not known if it went through")
                        }
                        main.postDelayed(this, TICK_MS); return
                    }

                    if (NagadRead.wrongPin(texts)) return stop("login_failed", "Nagad says the PIN is wrong; never typed again")
                    if (AppBanners.appError(texts) || AppBanners.network(texts)) sawWalletError = true

                    // After সাইন ইন: write down each new screen and any toast until Home (or the run ends), so a failed
                    // sign-in says what Nagad answered. A toast saying the PIN is wrong ends the run at once.
                    if (loginWall > 0 && !signedIn) {
                        for (t in WalletToasts.since(loginWall - 500)) {
                            if (!toastSeen.add(t.text)) continue
                            note("Nagad's message: ${t.text.take(140)}")
                            if (NagadRead.wrongPin(listOf(t.text))) return stop("login_failed", "Nagad says the PIN is wrong; never typed again")
                            if (AppBanners.appError(listOf(t.text)) || AppBanners.network(listOf(t.text))) sawWalletError = true
                        }
                        if (screen != NagadRead.Screen.LOGIN && screen != NagadRead.Screen.BUSY && screen != NagadRead.Screen.UNKNOWN && screen != NagadRead.Screen.LIMITED) {
                            signedIn = true
                            note("signed in")
                        } else if (screenText != lastTrail && trailNotes < 8) {
                            lastTrail = screenText; trailNotes++
                            note("after সাইন ইন: ${screenText.take(140)}")
                        }
                    }

                    // Nagad's "Rate limit exceeded. Too many requests. Please try again after 60 seconds." (seen in the
                    // recording after a few searches): press ঠিক আছে and wait what it asks, never hammer it.
                    NagadRead.rateLimit(texts)?.let { secs ->
                        limitSeen = true
                        progressAt = now
                        if (canAct) {
                            limitHits++
                            note("Nagad says too many requests: waiting $secs s ($limitHits)")
                            val ok = byId(nodes, "button1") ?: nodes.firstOrNull { !it.isEditable && NagadRead.lc(it.text?.toString()) in OK }
                            if (ok != null) press(svc, ok) else svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            val left = started + RUN_MS - now
                            if (limitHits > 3 || secs * 1000L + 15_000L > left) {
                                return when (task) {
                                    is NagadTask.Read -> if (seen.isNotEmpty()) finishRead("Nagad: too many requests") else stop("app_error", "Nagad: too many requests, no time left to wait")
                                    is NagadTask.Search -> { outcome = "the search did not run (Nagad: too many requests)"; finishSearch(task.query, "rate limit") }
                                    else -> stop("app_error", "Nagad: too many requests; nothing sent")
                                }
                            }
                            nextActAt = now + secs * 1000L + 2_000L
                            progressAt = nextActAt
                        }
                        main.postDelayed(this, TICK_MS); return
                    }

                    when (screen) {
                        NagadRead.Screen.BUSY -> { progressAt = now }
                        NagadRead.Screen.LIMITED -> { }
                        NagadRead.Screen.LOGIN -> {
                            progressAt = now
                            if (loginAt > 0) {
                                if (now - loginAt > LOGIN_WAIT_MS) return stop(LoginTrouble.stuck(sawWalletError), "still on the sign-in screen after the PIN" + if (sawWalletError) " (Nagad showed its own error: not a wrong PIN)" else "")
                            } else if (canAct) {
                                // The recording: EditText#pin_input_view shows "নগদ পিন" while empty (it is not a
                                // password box), four digit_view dots draw the PIN, and Button#progress_btn "সাইন ইন"
                                // is grey until the app holds the whole PIN. Pressing a grey button does nothing, which is
                                // exactly how the first three runs "signed in" and stayed on this screen.
                                val box = byId(nodes, "pin_input_view") ?: boxes.firstOrNull { it.isPassword }
                                    ?: boxes.firstOrNull { b -> NagadRead.lc(if (Build.VERSION.SDK_INT >= 26) b.hintText?.toString() else "").let { "পিন" in it || "pin" in it } }
                                    ?: return stop("pin_not_entered", "no PIN box on the sign-in screen")
                                val btn = byId(nodes, "progress_btn") ?: nodes.firstOrNull { !it.isEditable && NagadRead.lc(it.text?.toString()) in SIGN_IN }
                                val lit = enabled(btn) == true
                                when {
                                    pinWay > 0 && lit -> {
                                        note("সাইন ইন is lit (the app has the whole PIN, typed ${pinWays[pinWay - 1]}): pressing it once")
                                        loginAt = now; loginWall = now
                                        val clicked = try { btn!!.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }
                                        if (!clicked && !press(svc, btn!!)) note("সাইন ইন could not be pressed")
                                        else note("pressed সাইন ইন (${if (clicked) "the button's own click" else "a finger tap"})")
                                        nextActAt = now + pace.settle()
                                    }
                                    pinWay > 0 && now < pinCheckAt -> { }
                                    pinWay >= pinWays.size -> return stop("pin_not_entered", "Nagad did not take the PIN in any of ${pinWays.size} ways; সাইন ইন NOT pressed (no PIN was sent)")
                                    else -> {
                                        if (pinWay > 0) note("সাইন ইন stayed grey" + (if (keysMissing) " (the keyboard could not be used: no digit keys, or the box lost the focus)" else "") + ": trying another way")
                                        note("typing the PIN ${pinWays[pinWay]}")
                                        val ms = typePin(box, pinWay)
                                        pinWay++
                                        nextActAt = now + ms + pace.afterKeys()
                                        pinCheckAt = nextActAt + 2_500L
                                    }
                                }
                            }
                        }
                        NagadRead.Screen.HOME -> {
                            progressAt = now
                            when (task) {
                                is NagadTask.Balance -> {
                                    val v = byId(nodes, "balance_inquiry_text")?.text?.toString()?.let { NagadRead.takaAmount(it) } ?: NagadRead.balanceOf(texts)
                                    if (v != null && pillTaps > 0) {
                                        note("the balance shows")
                                        return finish(UssdOutcome(true, v, null, screens = listOf("Nagad app balance\nbalance: $v")), "done")
                                    }
                                    if (homeAt == 0L) homeAt = now
                                    if (v != null && pillTaps == 0) {
                                        // A figure from someone else's tap: wait for it to hide, then take it as it is.
                                        if (now - homeAt >= 10_000) return finish(UssdOutcome(true, v, null, screens = listOf("Nagad app balance\nbalance: $v\nNOTE: it was already showing before PayTrace tapped")), "done")
                                    } else if (canAct && (pillTaps == 0 || now - pillAt > 8_000)) {
                                        if (pillTaps >= 3) return stop("balance_not_shown", "the balance did not show after $pillTaps taps")
                                        val pill = byId(nodes, "balance_inquiry_button") ?: byId(nodes, "balance_inquiry_text")
                                            ?: nodes.firstOrNull { n -> NagadRead.lc(n.text?.toString()).let { "ব্যালেন্স" in it || "balance" in it } }
                                        if (pill == null) {
                                            nextActAt = now + 1_000
                                        } else {
                                            pillTaps++; pillAt = now
                                            note(if (pillTaps == 1) "tapping ব্যালেন্স জানতে ট্যাপ করুন" else "no figure yet: tapping again ($pillTaps)")
                                            press(svc, pill)
                                            nextActAt = now + pace.settle()
                                        }
                                    }
                                }
                                is NagadTask.CashIn -> if (canAct) {
                                    note("pressing the ক্যাশ ইন tile")
                                    if (!pressWords(svc, nodes, CASH_IN)) note("ক্যাশ ইন tile not found")
                                    nextActAt = now + pace.settle()
                                }
                                else -> if (canAct) {
                                    if (++drawerTries > 4) return stop("unexpected_screen", "the Nagad menu would not open")
                                    note("opening the menu (☰)")
                                    openDrawer(svc, nodes, drawerTries)
                                    nextActAt = now + pace.settle()
                                }
                            }
                        }
                        NagadRead.Screen.DRAWER -> if (canAct) {
                            progressAt = now
                            if (task is NagadTask.Read || task is NagadTask.Search) {
                                note("menu open: pressing বিবরণী")
                                if (!pressWords(svc, nodes, STATEMENT)) note("বিবরণী not found")
                            } else {
                                note("the menu is open: closing it")
                                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            }
                            nextActAt = now + pace.settle()
                        }
                        NagadRead.Screen.PICKER -> if (canAct) {
                            progressAt = now
                            // The type chooser (সব লেনদেন, ক্যাশ ইন, ক্যাশ আউট, বিটুবি ...): a read wants every type.
                            if ((task is NagadTask.Read || task is NagadTask.Search) && chipRemovals < 4) {
                                chipRemovals++
                                note("the type chooser is open: choosing সব লেনদেন")
                                if (!pressWords(svc, nodes, ALL_TYPES)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            } else {
                                note("a chooser PayTrace did not open: closing it")
                                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            }
                            nextActAt = now + pace.settle()
                        }
                        NagadRead.Screen.DETAILS -> if (canAct) {
                            progressAt = now
                            val key = openKey
                            if (key != null) {
                                val trx = (byId(nodes, "tx_ref_view")?.text?.toString() ?: NagadRead.after(texts, NagadRead.TRX_L))
                                    ?.trim()?.uppercase(Locale.ROOT)?.takeIf { Regex("^[A-Z0-9]{6,24}$").matches(it) }
                                // The box must be the row that was opened: same amount ("500 টাকা").
                                val boxAmount = byId(nodes, "amount_view")?.text?.toString()?.let { NagadRead.takaAmount(it) ?: NagadRead.plainAmount(it) }
                                val rowAmount = seen[key]?.amount
                                val same = boxAmount == null || rowAmount == null || Math.abs(boxAmount - rowAmount) < 0.005
                                note("opened row: TrxID ${trx ?: "not readable"}" + if (!same) " (but the box shows Tk $boxAmount, not Tk $rowAmount: not used)" else "")
                                if (trx != null && same) sheetTrx[key] = trx
                                toOpen.remove(key)
                                openKey = null
                            } else note("a box PayTrace did not open: closing it")
                            val close = byId(nodes, "close_action_view")
                            if (close == null || !press(svc, close)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            nextActAt = now + pace.settle()
                        }
                        NagadRead.Screen.STATEMENT -> {
                            progressAt = now
                            val searchBox = byId(nodes, "search_edit_text")
                            // The search box shows its own label as text while empty; once something is typed the label
                            // moves to the hint.
                            fun typed(b: AccessibilityNodeInfo?): String =
                                if (b == null || b.isShowingHintText || b.hintText == null) "" else (b.text?.toString() ?: "")
                            val chipX = byId(nodes, "filter_chip_remove_btn")
                            if (task !is NagadTask.Read && task !is NagadTask.Search) {
                                if (canAct) { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK); nextActAt = now + pace.settle() }
                            } else if (!NagadRead.onTransactions(ids)) {
                                if (canAct) {
                                    if (++tabPresses > 4) return stop("unexpected_screen", "the লেনদেন tab would not open")
                                    note("pressing the লেনদেন tab")
                                    if (!pressWords(svc, nodes, TX_TAB)) note("লেনদেন tab not found")
                                    nextActAt = now + pace.settle()
                                }
                            } else if (chipX != null) {
                                // A type filter left on the list (the recording found "বিটুবি" still chosen from an earlier
                                // visit, so only B2B rows showed): take it off before reading anything.
                                if (canAct) {
                                    if (++chipRemovals > 4) return stop("unexpected_screen", "the list's filter would not come off")
                                    note("a filter (${byId(nodes, "filter_chip_tv")?.text ?: "?"}) was left on the list: removing it")
                                    press(svc, chipX)
                                    nextActAt = now + pace.settle()
                                }
                            } else if (task is NagadTask.Read && canAct) {
                                if (!searchCleared && typed(searchBox).isNotBlank()) {
                                    searchCleared = true
                                    note("a search (${typed(searchBox)}) was left in the box: emptying it")
                                    setText(searchBox!!, "")
                                    nextActAt = now + pace.settle()
                                    main.postDelayed(this, TICK_MS); return
                                }
                                val rows = rowsOn(nodes)
                                if (rows.isEmpty() && NagadRead.noRows(texts)) {
                                    // "আপনার কোন লেনদেনের তথ্য নেই": the list did not load (or a refusal emptied it). Ask it
                                    // again once ("আবার চেষ্টা করুন"), then end the read with what it has.
                                    if (emptyAt == 0L) emptyAt = now
                                    if (retryTaps < 1 && !limitSeen) {
                                        retryTaps++
                                        note("the list says it is empty: pressing আবার চেষ্টা করুন")
                                        byId(nodes, "tap_tv")?.let { press(svc, it) }
                                        nextActAt = now + pace.settle()
                                    } else if (now - emptyAt > 10_000) return finishRead("the list stayed empty")
                                    main.postDelayed(this, TICK_MS); return
                                }
                                var fresh = 0
                                for ((k, row) in rows) if (seen.putIfAbsent(k, row) == null) fresh++
                                val keys = rows.map { it.first }.toSet()
                                if (seen.size >= MAX_ROWS) return finishRead("row limit")
                                if (rows.any { it.second.at < task.cutoff }) return finishRead("reached ${Instant.ofEpochMilli(task.cutoff).atZone(NagadRead.DHAKA).toLocalDateTime()}")
                                if (AppReader.jumped(lastKeys, keys) && backSwipes < 6) {
                                    backSwipes++
                                    note("the list jumped: going back a little")
                                    AppReader.swipe(svc, false)
                                } else {
                                    stale = if (fresh == 0) stale + 1 else 0
                                    if (stale >= 3) return finishRead("end of the list")
                                    if (++swipes > MAX_SWIPES) return finishRead("swipe limit")
                                    AppReader.swipe(svc, true)
                                }
                                lastKeys = keys
                                nextActAt = now + pace.swipeMs() + pace.readPause()
                            } else if (task is NagadTask.Search && canAct) {
                                val q = task.query
                                when (sStage) {
                                    0 -> {
                                        if (searchBox == null) return finishSearch(q, "no search box")
                                        if (++sTypes > 3) { outcome = "could not type it"; return finishSearch(q, "the search box would not take the query") }
                                        note("typing $q into the search box" + if (sTypes == 3) " on the keyboard" else "")
                                        keysMissing = false
                                        val ms = if (sTypes < 3) typeSet(searchBox, q, sTypes == 2) else typeKeys(searchBox, q, 16)
                                        sStage = 1
                                        nextActAt = now + ms + pace.afterKeys()
                                    }
                                    1 -> {
                                        val shown = typed(searchBox).replace(" ", "").uppercase(Locale.ROOT)
                                        if (shown != q) { note("the box shows \"$shown\": typing again"); sStage = 0; return run() }
                                        submit(svc, searchBox!!, nodes, sWays)
                                        note("pressing search (way ${sWays + 1})")
                                        sWays++; sAt = now; sStage = 2
                                        nextActAt = now + 3_000
                                    }
                                    2 -> {
                                        val rows = rowsOn(nodes)
                                        for ((k, row) in rows) seen.putIfAbsent(k, row)
                                        val phone = Regex("^01\\d{9}$").matches(q)
                                        val folded = NagadRead.fold(rows.map { it.second })
                                        val empty = rows.isEmpty() && NagadRead.noRows(texts)
                                        val applied = when {
                                            rows.isEmpty() -> true
                                            phone -> folded.all { NagadRead.samePhone(it.party, q) }
                                            else -> folded.size <= 3 || folded.any { it.trx == q }
                                        }
                                        when {
                                            !applied && sWays < 3 -> { note("the list did not change: pressing search another way"); sStage = 1 }
                                            !applied -> { outcome = "the search did not run"; return finishSearch(q, "search not applied") }
                                            rows.isEmpty() -> {
                                                if (empty && limitSeen) { outcome = "the search did not run (Nagad: too many requests)"; return finishSearch(q, "rate limit") }
                                                if (now - sAt > 8_000) { outcome = if (empty) "nothing found" else "nothing came up"; return finishSearch(q, "no rows") }
                                            }
                                            phone || folded.any { it.trx == q } -> return finishSearch(q, "found")
                                            else -> {
                                                // A TrxID with no commission row to name it: open the rows (at most 3) and read their box.
                                                rows.filter { !it.second.kind.commission && it.first !in sheetTrx }.map { it.first }.take(3).forEach { if (it !in toOpen) toOpen.add(it) }
                                                sStage = 3
                                            }
                                        }
                                        nextActAt = now + pace.readPause()
                                    }
                                    3 -> {
                                        if (sheetTrx.values.contains(q)) return finishSearch(q, "found")
                                        val k = toOpen.firstOrNull { it !in sheetTrx }
                                        if (k == null || now - openAt > 40_000 && openAt > 0) return finishSearch(q, "rows opened")
                                        val n = nodeOf[k]
                                        if (n == null) { toOpen.remove(k); return run() }
                                        if (openKey == k) { toOpen.remove(k); openKey = null; return run() }
                                        note("opening a row to read its TrxID")
                                        openKey = k; if (openAt == 0L) openAt = now
                                        press(svc, n)
                                        nextActAt = now + pace.settle()
                                    }
                                }
                            }
                        }
                        NagadRead.Screen.CASHIN -> {
                            progressAt = now
                            if (task !is NagadTask.CashIn) {
                                if (canAct) { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK); nextActAt = now + pace.settle() }
                            } else if (canAct) {
                                // The recording's form: EditText#destination_account_input_view (shows "01618-749601"),
                                // EditText#amount_input_view, EditText#pin_input_view (the same drawn PIN box as the sign-in)
                                // and Button#progress_btn "সাবমিট", grey until all three are complete.
                                val o = task.order
                                val acct = byId(nodes, "destination_account_input_view") ?: boxes.getOrNull(0)
                                val amt = byId(nodes, "amount_input_view") ?: boxes.getOrNull(1)
                                val pinBox = byId(nodes, "pin_input_view") ?: boxes.firstOrNull { it.isPassword } ?: boxes.getOrNull(2)
                                if (acct == null || amt == null || pinBox == null) return stop("app_stopped_before_send", "the Cash In form did not show its three boxes")
                                val btn = byId(nodes, "progress_btn") ?: nodes.firstOrNull { !it.isEditable && NagadRead.lc(it.text?.toString()) in SUBMIT }
                                val lit = enabled(btn) == true
                                val acctOk = NagadRead.digits(acct.text?.toString()) == o.number
                                val amtOk = NagadRead.latin(amt.text?.toString() ?: "").replace(",", "").trim().toDoubleOrNull()?.let { Math.abs(it - o.amount) < 0.005 } == true
                                val want = NagadRead.money(o.amount)
                                when {
                                    submits > 0 -> {
                                        // The sheet did not come: press সাবমিট once more (it only opens the sheet), and only
                                        // while the form still shows this number and amount and the button is lit.
                                        if (now - submitAt > 8_000) {
                                            if (submits >= 2 || !acctOk || !amtOk || !lit) return stop("app_stopped_before_send", "সাবমিট did not open the confirmation; nothing sent")
                                            submits++; submitAt = now
                                            note("no confirmation yet: pressing সাবমিট again")
                                            press(svc, btn!!)
                                            nextActAt = now + pace.settle()
                                        }
                                    }
                                    !acctOk -> {
                                        if (cStage > 0 || ++cTypes > 2) return stop("app_stopped_before_send", "the number would not go into the box")
                                        note("typing the number" + if (cTypes == 2) " on the keyboard" else "")
                                        val ms = if (cTypes == 1) typeSet(acct, o.number, true) else typeKeys(acct, o.number, 16)
                                        nextActAt = now + ms + pace.afterKeys()
                                    }
                                    !amtOk -> {
                                        if (cStage > 1) return stop("app_stopped_before_send", "the amount changed in the box")
                                        if (cStage == 0) { cStage = 1; cTypes = 0 }
                                        if (++cTypes > 2) return stop("app_stopped_before_send", "the amount would not go into the box")
                                        note("typing the amount" + if (cTypes == 2) " on the keyboard" else "")
                                        val ms = if (cTypes == 1) typeSet(amt, want, true) else typeKeys(amt, want, 10)
                                        nextActAt = now + ms + pace.afterKeys()
                                    }
                                    cPinWay > 0 && lit -> {
                                        note("সাবমিট is lit with ${o.number} and Tk $want on the form: pressing it (this only opens the confirmation)")
                                        submits = 1; submitAt = now
                                        val clicked = try { btn!!.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }
                                        if (!clicked) press(svc, btn!!)
                                        nextActAt = now + pace.settle()
                                    }
                                    cPinWay > 0 && now < cPinCheckAt -> { }
                                    cPinWay >= pinWays.size -> return stop("pin_not_entered", "Nagad did not take the PIN in any of ${pinWays.size} ways; সাবমিট NOT pressed, nothing sent")
                                    else -> {
                                        // The PIN only on this form, which shows THIS number and THIS amount (checked just above).
                                        cStage = 2
                                        if (cPinWay > 0) note("সাবমিট stayed grey" + (if (keysMissing) " (the keyboard could not be used: no digit keys, or the box lost the focus)" else "") + ": trying another way")
                                        note("the form shows ${o.number} and Tk $want: typing the PIN ${pinWays[cPinWay]}")
                                        val ms = typePin(pinBox, cPinWay)
                                        cPinWay++
                                        nextActAt = now + ms + pace.afterKeys()
                                        cPinCheckAt = nextActAt + 2_500L
                                    }
                                }
                            }
                        }
                        NagadRead.Screen.CONFIRM -> {
                            progressAt = now
                            if (task !is NagadTask.CashIn) {
                                if (canAct) { note("a confirmation PayTrace did not ask for: pressing না"); pressWords(svc, nodes, NO); nextActAt = now + pace.settle() }
                            } else if (canAct) {
                                val c = NagadRead.confirmOf(texts)
                                if (!NagadRead.confirmMatches(c, task.order.number, task.order.amount)) {
                                    note("the confirmation shows ${c.number} / ${c.amount}, not ${task.order.number} / ${task.order.amount}: pressing না")
                                    pressWords(svc, nodes, NO)
                                    return stop("confirm_does_not_match", "the confirmation did not match; nothing sent")
                                }
                                note("the confirmation shows ${c.number} and Tk ${NagadRead.money(c.amount ?: 0.0)}: pressing হ্যাঁ")
                                yesAt = now
                                if (!pressWords(svc, nodes, YES)) {
                                    yesAt = 0L
                                    return stop("app_stopped_before_send", "হ্যাঁ could not be pressed; nothing sent")
                                }
                            }
                        }
                        NagadRead.Screen.RESULT -> if (canAct) {
                            note("a receipt PayTrace did not make: pressing পরবর্তী")
                            pressWords(svc, nodes, NEXT)
                            nextActAt = now + pace.settle()
                        }
                        NagadRead.Screen.UNKNOWN -> {
                            if (texts.isNotEmpty() && canAct && now - progressAt > 8_000 && backs < 4) {
                                backs++
                                note("a screen PayTrace does not know: going back")
                                svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                progressAt = now
                                nextActAt = now + pace.settle()
                            } else if (now - progressAt > STUCK_MS) {
                                return when (task) {
                                    is NagadTask.Read -> if (seen.isNotEmpty()) { finishRead("a screen PayTrace does not know") } else stop("unexpected_screen", "a screen PayTrace does not know")
                                    is NagadTask.CashIn -> stop("app_stopped_before_send", "a screen PayTrace does not know; nothing sent")
                                    else -> stop("unexpected_screen", "a screen PayTrace does not know")
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    // A window that changed while being read; the next tick reads again.
                }
                main.postDelayed(this, TICK_MS)
            }
        }
        note("opening $pkg: " + when (task) {
            is NagadTask.Balance -> "reading the Nagad balance"
            is NagadTask.Read -> "reading the statement back to ${Instant.ofEpochMilli(task.cutoff).atZone(NagadRead.DHAKA).toLocalDateTime()}"
            is NagadTask.Search -> "searching for ${task.query}"
            is NagadTask.CashIn -> "Cash In Tk ${NagadRead.money(task.order.amount)} to ${task.order.number}"
        })
        AppReader.openBkash(svc, app, pkg, woke) { note(it) }
        main.postDelayed(tick, pace.settle())
    }

    /** The ☰ menu button: by its description, else the tappable thing in the top-left corner, else a finger drag in from
     *  the left edge (each try a different way). */
    private fun openDrawer(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>, attempt: Int) {
        val dm = svc.resources.displayMetrics
        val byDesc = nodes.firstOrNull { n ->
            NagadRead.lc(n.contentDescription?.toString()).let { "drawer" in it || "navigat" in it || "menu" in it || "মেনু" in it || "নেভিগেট" in it }
        }
        val corner = nodes.filter { it.isClickable }.firstOrNull { n ->
            val r = Rect().also { n.getBoundsInScreen(it) }
            !r.isEmpty && r.right < dm.widthPixels * 0.25 && r.bottom < dm.heightPixels * 0.15 && r.width() < dm.widthPixels * 0.25
        }
        val target = if (attempt % 2 == 1) byDesc ?: corner else corner ?: byDesc
        if (target != null && attempt < 4 && press(svc, target)) return
        AppReader.edgeSwipe(svc)
    }

    /** Presses search a different way on each try: the magnifier right of the box, the keyboard's search key, a finger tap. */
    private fun submit(svc: AccessibilityService, box: AccessibilityNodeInfo, nodes: List<AccessibilityNodeInfo>, way: Int) {
        val b = Rect().also { box.getBoundsInScreen(it) }
        // ImageButton#search_icon_btn [সার্চ] takes the filter icon's place once something is typed (recording).
        val icon = byId(nodes, "search_icon_btn") ?: nodes.filter { it.isClickable && it != box && !it.isEditable }.filter { n ->
            val r = Rect().also { n.getBoundsInScreen(it) }
            !r.isEmpty && r.left >= b.centerX() && r.centerY() in (b.top - 20)..(b.bottom + 20) && r.width() < b.width() / 2 + 200
        }.minByOrNull { n -> Rect().also { n.getBoundsInScreen(it) }.width() }
        when (way % 3) {
            0 -> if (icon != null && (try { icon.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false })) return
            1 -> if (Build.VERSION.SDK_INT >= 30) {
                try { if (box.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) return } catch (e: Exception) { }
            }
        }
        if (icon != null) AppReader.tap(svc, icon)
        else if (Build.VERSION.SDK_INT >= 30) try { box.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) } catch (e: Exception) { }
    }
}

package com.paytrace.app

import org.json.JSONObject
import java.util.Locale

/** What the server asks one bKash app read to look for (owner 2026-11-10: "yes build both"): read back at least to
 *  [backTo], and open the rows of [finds] to read their TrxID. Sent with an "appread" command as `look`
 *  (`{"back_to": ms, "find": [{"trx", "at", "amount", "party"}]}`); a read without it works as before.
 *
 *  Why: the bKash app's list shows no TrxID; only a row's detail sheet does. A held SMS is released only when the row
 *  that is its own (same minute, amount and masked number) opens to the SMS's own TrxID, so a fake SMS that copies a
 *  real payment's minute, amount and number can never take that payment's row. Pure, unit tested. */
data class AppLook(val backTo: Long?, val finds: List<Target>) {
    data class Target(val trx: String, val at: Long, val amount: Double, val party: String?)

    companion object {
        /** At most this many rows are opened in one read (each costs a few seconds). */
        const val MAX_FINDS = 5
        /** Never read back further than this, whatever is asked. */
        const val MAX_BACK_MS = 7 * 24 * 3_600_000L
        /** A row read back this much further than asked, so a row of the very minute is on screen. */
        const val MARGIN_MS = 10 * 60_000L
        private val MASKED = Regex("^01[0-9X]{9}$")
        private val TRX = Regex("^[A-Z]{2}[A-Z0-9]{6,10}$")
        private val TAKA = Regex("৳\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)")

        fun parse(o: JSONObject?): AppLook? {
            if (o == null) return null
            val back = if (o.has("back_to")) o.optLong("back_to", 0L).takeIf { it > 0 } else null
            val finds = ArrayList<Target>()
            val arr = o.optJSONArray("find")
            if (arr != null) for (i in 0 until arr.length()) {
                val f = arr.optJSONObject(i) ?: continue
                val trx = f.optString("trx").trim().uppercase(Locale.ROOT)
                val at = f.optLong("at", 0L)
                val amount = f.optDouble("amount", -1.0)
                if (!TRX.matches(trx) || at <= 0 || amount <= 0) continue
                val party = f.optString("party").trim().uppercase(Locale.ROOT).takeIf { MASKED.matches(it) }
                finds.add(Target(trx, at, amount, party))
                if (finds.size >= MAX_FINDS) break
            }
            if (back == null && finds.isEmpty()) return null
            return AppLook(back, finds)
        }

        /** How far back this read must go: the usual cut-off, or earlier when asked (never more than [MAX_BACK_MS]). */
        fun cutoff(usual: Long, look: AppLook?, now: Long): Long {
            val asked = look?.backTo ?: return usual
            return minOf(usual, maxOf(asked - MARGIN_MS, now - MAX_BACK_MS))
        }

        /** The unsigned taka figure of a row's amount part ("+ ৳1,377" -> 1377.0). */
        fun amountOf(parts: List<String>): Double? = parts.firstNotNullOfOrNull { p ->
            if (!p.trim().startsWith("+") && !p.trim().startsWith("-")) null
            else TAKA.find(p)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()
        }

        fun partyOf(parts: List<String>): String? = parts.map { it.trim().uppercase(Locale.ROOT) }.firstOrNull { MASKED.matches(it) }

        /** True when a list row is this target: the same minute (+/- 1), the same amount, the same masked number (when both
         *  have one). Only such a row is ever opened. */
        fun matches(parts: List<String>, t: Target): Boolean {
            val at = AppReader.rowTime(parts) ?: return false
            if (Math.abs(at / 60_000L - t.at / 60_000L) > 1) return false
            val amount = amountOf(parts) ?: return false
            if (Math.abs(amount - t.amount) > 0.005) return false
            val party = partyOf(parts)
            return party == null || t.party == null || party == t.party
        }

        /** The TrxID on an opened row's sheet: two letters then letters and digits, with at least one digit. A masked
         *  number (0162XXXX056) starts with a digit and is never taken. Null when there is none, or more than one. */
        fun trxOn(texts: List<String>): String? {
            val found = texts.map { it.trim() }.filter { TRX.matches(it) && it.any(Char::isDigit) }.distinct()
            return found.singleOrNull()
        }

        /** True when the opened sheet is the target's: its time (+/- 1 minute) and its amount are on it. */
        fun sheetIs(texts: List<String>, t: Target): Boolean {
            val at = texts.firstNotNullOfOrNull { AppReader.timeOf(it) } ?: return false
            if (Math.abs(at / 60_000L - t.at / 60_000L) > 1) return false
            return texts.any { s -> TAKA.findAll(s).any { m -> m.groupValues[1].replace(",", "").toDoubleOrNull()?.let { Math.abs(it - t.amount) < 0.005 } == true } }
        }

        /** One line per opened row for the server, in the row's own terms (what the server keeps for it):
         *  "opened <row minute ms> <amount> <masked number or -> <TrxID read or ->". */
        fun line(rowAt: Long, amount: Double, party: String?, read: String?): String =
            String.format(Locale.US, "opened %d %.2f %s %s", rowAt, amount, party ?: "-", read ?: "-")

        const val OPENED_MARK = "Opened rows:"
    }
}

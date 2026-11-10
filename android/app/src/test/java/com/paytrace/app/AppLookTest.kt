package com.paytrace.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rows and the detail sheet are the owner's real ones (bKash Business 3.10.2, Vivo, recorder runs of 2026-11-10). */
class AppLookTest {
    private val row = listOf("ক্যাশ আউট", "0162XXXX056", "07:07pm 09/11/26", "+ ৳2,592")
    private val sheet = listOf("ক্যাশ আউট", "বন্ধ করুন", "0162XXXX056", "৳2,592", "৳0", "৳2,592", "৳0", "07:07pm 09/11/26", "DK969QZD7G", "রেফারেন্স")
    private val at = AppReader.timeOf("07:07pm 09/11/26")!!
    private val target = AppLook.Target("DK969QZD7G", at, 2592.0, "0162XXXX056")

    @Test fun parsesWhatTheServerSends() {
        val look = AppLook.parse(JSONObject("""{"back_to": 1794270000000, "find": [{"trx": "dk969qzd7g", "at": $at, "amount": 2592, "party": "0162XXXX056"},
            {"trx": "bad", "at": 1, "amount": 5}]}"""))!!
        assertEquals(1794270000000L, look.backTo)
        assertEquals(listOf(target), look.finds)
        assertNull(AppLook.parse(JSONObject("{}")))
        assertNull(AppLook.parse(null))
        // At most five rows are opened in one read.
        val many = (1..9).joinToString(",") { """{"trx": "DK96${it}QZD7G", "at": $at, "amount": $it}""" }
        assertEquals(AppLook.MAX_FINDS, AppLook.parse(JSONObject("""{"find": [$many]}"""))!!.finds.size)
    }

    @Test fun readsBackFarEnough() {
        val now = at + 3_600_000L
        assertEquals(now - 100, AppLook.cutoff(now - 100, null, now))
        // Asked to reach an older payment: the cut-off moves back, with a margin; never more than a week.
        val asked = AppLook(at - 20 * 3_600_000L, emptyList())
        assertEquals(at - 20 * 3_600_000L - AppLook.MARGIN_MS, AppLook.cutoff(now - 6 * 3_600_000L, asked, now))
        assertEquals(now - AppLook.MAX_BACK_MS, AppLook.cutoff(now - 100, AppLook(1L, emptyList()), now))
        // Never later than the usual cut-off.
        assertEquals(now - 9 * 3_600_000L, AppLook.cutoff(now - 9 * 3_600_000L, AppLook(now - 3_600_000L, emptyList()), now))
    }

    @Test fun opensOnlyItsOwnRow() {
        assertTrue(AppLook.matches(row, target))
        assertEquals(2592.0, AppLook.amountOf(row)!!, 0.001)
        assertEquals("0162XXXX056", AppLook.partyOf(row))
        assertFalse(AppLook.matches(row.map { it.replace("2,592", "2,593") }, target))
        assertFalse(AppLook.matches(row.map { it.replace("0162XXXX056", "0162XXXX057") }, target))
        assertFalse(AppLook.matches(row.map { it.replace("07:07pm", "07:09pm") }, target))
        assertTrue(AppLook.matches(row.map { it.replace("07:07pm", "07:08pm") }, target))
        // No masked number on the row or the target: minute and amount decide.
        assertTrue(AppLook.matches(row, target.copy(party = null)))
    }

    @Test fun readsTheTrxIdOnTheSheet() {
        assertEquals("DK969QZD7G", AppLook.trxOn(sheet))
        assertTrue(AppLook.sheetIs(sheet, target))
        // The masked number is never taken for a TrxID.
        assertNull(AppLook.trxOn(listOf("0162XXXX056", "৳2,592")))
        // Two different ids on one screen: not sure which, so none.
        assertNull(AppLook.trxOn(sheet + "DKA1AWJZ9L"))
        // A sheet of another minute or amount is not the target's.
        assertFalse(AppLook.sheetIs(sheet.map { it.replace("07:07pm", "07:30pm") }, target))
        assertFalse(AppLook.sheetIs(sheet.map { it.replace("2,592", "2,000") }, target))
    }

    @Test fun aStatementSearchResultIsReadLikeAnInboxRow() {
        // The owner's search on the Vivo (2026-11-10): the result row shows the full number, the Inbox the hidden one.
        val result = listOf("ক্যাশ আউট", "01322784471", "09:17pm 10/11/26", "+ ৳500", "কমিশন: + ৳2")
        val t = AppLook.Target("DKA5BKXU6Z", AppReader.timeOf("09:17pm 10/11/26")!!, 500.0, "0132XXXX471")
        assertEquals("0132XXXX471", AppLook.partyOf(result))
        assertTrue(AppLook.matches(result, t))
        assertFalse(AppLook.matches(result.map { it.replace("01322784471", "01322784472") }, t))
        // Sent to the server exactly like the Inbox row of the same transaction.
        assertEquals("ক্যাশ আউট | 0132XXXX471 | 09:17pm 10/11/26 | + ৳500 | কমিশন: + ৳2", AppLook.maskedRow(result))
        assertEquals("0162XXXX056", AppLook.mask("0162XXXX056"))
    }

    @Test fun knowsTheNothingFoundPage() {
        assertTrue(AppLook.nothingFound(listOf("কোনো লেনদেন পাওয়া যায়নি")))
        // The same words with য় stored as one letter, and as য + dot.
        assertTrue(AppLook.nothingFound(listOf("কোনো লেনদেন পাও\u09DFা যা\u09DFনি")))
        assertTrue(AppLook.nothingFound(listOf("কোনো লেনদেন পাও\u09AF\u09BCা যা\u09AF\u09BCনি")))
        assertTrue(AppLook.nothingFound(listOf("No transaction found")))
        assertFalse(AppLook.nothingFound(listOf("লেনদেনের বিবরণী", "সার্চ করুন", "ক্যাশ আউট")))
    }

    @Test fun reportsInTheRowsOwnTerms() {
        assertEquals("opened $at 2592.00 0162XXXX056 DK969QZD7G", AppLook.line(at, 2592.0, "0162XXXX056", "DK969QZD7G"))
        assertEquals("opened $at 2592.00 - -", AppLook.line(at, 2592.0, null, null))
        // The opened lines ride before the step log and never look like a row to the server.
        val out = AppReader.pack("h", listOf("ক্যাশ আউট | 0162XXXX056 | 07:07pm 09/11/26 | + ৳2,592"), "log", listOf(AppLook.line(at, 2592.0, "0162XXXX056", "DK969QZD7G")))
        assertTrue(out[out.size - 2].startsWith(AppLook.OPENED_MARK))
        assertFalse(out[out.size - 2].contains(" | "))
        assertTrue(out.last().startsWith(AppReader.TRACE_MARK))
    }
}

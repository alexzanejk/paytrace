package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bKash-app reader's pure parts, built from the real Vivo recording (bKash Business 3.10.2, 2026-11-10). */
class AppReaderTest {
    @Test fun rowTimesAreBangladeshTime() {
        // 01:20am 09/11/26 in Dhaka (UTC+6) = 2026-11-08 19:20 UTC.
        assertEquals(1_794_165_600_000L, AppReader.timeOf("01:20am 09/11/26"))
        assertEquals(1_794_165_600_000L + 12 * 3_600_000L, AppReader.timeOf("01:20pm 09/11/26"))
        assertEquals(AppReader.timeOf("12:34am 08/11/26")!! + 3_600_000L, AppReader.timeOf("01:34am 08/11/26"))
        assertNull(AppReader.timeOf("ক্যাশ আউট"))
        assertNull(AppReader.timeOf("13:20pm 08/11/26"))
    }

    @Test fun onlyWholeRowsAreKept() {
        assertTrue(AppReader.complete(listOf("ক্যাশ ইন", "0173XXXX653", "01:20am 09/11/26", "- ৳21,250", "কমিশন: + ৳79.69")))
        assertTrue(AppReader.complete(listOf("ক্যাশ আউট", "0131XXXX331", "09:54pm 08/11/26", "+ ৳1,161")))
        // Cut off at the bottom of the screen: the time is not on screen yet.
        assertFalse(AppReader.complete(listOf("ক্যাশ আউট", "0160XXXX096", "+ ৳1,970")))
        // Cut off at the top: no amount.
        assertFalse(AppReader.complete(listOf("0135XXXX700", "07:33pm 08/11/26")))
    }

    @Test fun readBackFarEnoughButNotForever() {
        val now = 1_800_000_000_000L
        assertEquals(now - AppReader.FAR_MS, AppReader.cutoff(null, now))
        // Just read an hour ago: still at least 6 hours back.
        assertEquals(now - AppReader.NEAR_MS, AppReader.cutoff(now - 3_600_000L, now))
        // Last read 20 hours ago: from 2 hours before that.
        assertEquals(now - 22 * 3_600_000L, AppReader.cutoff(now - 20 * 3_600_000L, now))
        // A week ago: never more than 48 hours.
        assertEquals(now - AppReader.FAR_MS, AppReader.cutoff(now - 7 * 24 * 3_600_000L, now))
    }

    @Test fun onlyAPlainPinIsTyped() {
        assertEquals(listOf("1", "2", "3", "4", "5"), AppReader.pinKeys("12345"))
        assertNull(AppReader.pinKeys(""))
        assertNull(AppReader.pinKeys("12*45"))
        assertNull(AppReader.pinKeys("123"))
    }

    @Test fun packingKeepsWholeRowsAndTheNewest() {
        val rows = List(300) { i -> "ক্যাশ আউট | 0131XXXX331 | 09:54pm 08/11/26 | + ৳${1000 + i}" }
        val out = AppReader.pack("bKash app transactions", rows)
        assertTrue(out.size <= 12)
        assertTrue(out.sumOf { it.length } <= AppReader.TOTAL_CHARS)
        assertTrue(out.all { it.length <= AppReader.CHUNK_CHARS })
        // Every line after the header is a whole row, and the first one is the newest.
        assertTrue(out.drop(1).flatMap { it.split('\n') }.all { it.startsWith("ক্যাশ আউট | ") && it.contains("৳") })
        assertTrue(out[1].startsWith("ক্যাশ আউট | 0131XXXX331 | 09:54pm 08/11/26 | + ৳1000"))
        assertTrue(out[0].contains("rows: 300"))
    }

    @Test fun pacedLikeAPerson() {
        val p = HumanPace(java.util.Random(7))
        repeat(200) {
            assertTrue(p.keyGap() in 800L..1_400L)
            assertTrue(p.afterKeys() in 1_000L..1_600L)
            assertTrue(p.settle() in 1_800L..3_200L)
            assertTrue(p.readPause() in 1_300L..2_600L)
            assertTrue(p.swipeMs() in 600L..1_000L)
            assertTrue(p.holdMs() in 220L..380L)
            val (x, y) = p.pointIn(100, 200, 300, 260)
            assertTrue(x in 160f..240f && y in 218f..242f)
            val sw = p.swipe()
            assertTrue(sw[1] > sw[2] + 0.25)
            // About a third of the screen, never most of it: every row is seen whole at least once.
            assertTrue(sw[1] - sw[2] < 0.43)
        }
        // Not the same gap twice in a row every time: it varies.
        assertTrue((1..20).map { p.keyGap() }.toSet().size > 10)
    }

    @Test fun aJumpIsNoticed() {
        // Build 173 on the Vivo: the list flung past 3 rows between two reads that shared nothing.
        assertTrue(AppReader.jumped(setOf("a", "b", "c"), setOf("x", "y")))
        assertFalse(AppReader.jumped(setOf("a", "b", "c"), setOf("c", "d")))
        assertFalse(AppReader.jumped(emptySet(), setOf("x")))
        assertFalse(AppReader.jumped(setOf("a"), emptySet()))
    }

    @Test fun rowsFoundGoingBackAreSentInTimeOrder() {
        // Read in this order: a jump to 10:00, then back to the missed 11:00.
        val rows = linkedMapOf("12:00" to 1_200L, "10:00" to 1_000L, "11:00" to 1_100L, "10:00 again" to 1_000L)
        assertEquals(listOf("12:00", "11:00", "10:00", "10:00 again"), AppReader.ordered(rows))
    }

    @Test fun aPinDigitIsCheckedBeforeTheNext() {
        val S = PinTyping.Step.values().associateBy { it.name }
        // Nothing pressed yet: press the first digit.
        assertEquals(S["PRESS"], PinTyping.next(0, 5, 0, pressed = false, waitedMs = 0, retries = 0))
        // Pressed, the box does not show it yet: wait, then press it again, then stop.
        assertEquals(S["WAIT"], PinTyping.next(0, 5, 0, pressed = true, waitedMs = 700, retries = 0))
        assertEquals(S["RETRY"], PinTyping.next(0, 5, 0, pressed = true, waitedMs = 1_900, retries = 0))
        assertEquals(S["STOP"], PinTyping.next(0, 5, 0, pressed = true, waitedMs = 1_900, retries = PinTyping.RETRIES))
        // The box shows it: confirmed, then the next digit.
        assertEquals(S["CONFIRMED"], PinTyping.next(2, 5, 3, pressed = true, waitedMs = 400, retries = 0))
        assertEquals(S["PRESS"], PinTyping.next(3, 5, 3, pressed = false, waitedMs = 0, retries = 0))
        // A lagging key that landed twice, or a box that lost digits: stop, never log in.
        assertEquals(S["STOP"], PinTyping.next(2, 5, 4, pressed = true, waitedMs = 400, retries = 0))
        assertEquals(S["STOP"], PinTyping.next(3, 5, 2, pressed = false, waitedMs = 0, retries = 0))
        // Log in only when the box shows exactly the whole PIN (owner 2026-11-10: a short PIN was sent).
        assertEquals(S["LOGIN"], PinTyping.next(5, 5, 5, pressed = false, waitedMs = 0, retries = 0))
        assertEquals(S["STOP"], PinTyping.next(5, 5, 4, pressed = false, waitedMs = 0, retries = 0))
        // A box that cannot be read: slow timing alone.
        assertEquals(S["WAIT"], PinTyping.next(1, 5, null, pressed = true, waitedMs = 900, retries = 0))
        assertEquals(S["CONFIRMED"], PinTyping.next(1, 5, null, pressed = true, waitedMs = 1_700, retries = 0))
        assertEquals(S["LOGIN"], PinTyping.next(5, 5, null, pressed = false, waitedMs = 0, retries = 0))
    }

    @Test fun theBoxIsCountedNotRead() {
        assertEquals(0, PinTyping.shownCount(null, "এজেন্ট পিন নাম্বার দিন"))
        assertEquals(0, PinTyping.shownCount("এজেন্ট পিন নাম্বার দিন", "এজেন্ট পিন নাম্বার দিন"))
        assertEquals(3, PinTyping.shownCount("•••", "এজেন্ট পিন নাম্বার দিন"))
        assertEquals(5, PinTyping.shownCount("• • • • •", null))
    }

    @Test fun aSuccessfulReadKeepsItsLogLast() {
        val rows = List(300) { i -> "ক্যাশ আউট | 0131XXXX331 | 09:54pm 08/11/26 | + ৳${1000 + i}" }
        val out = AppReader.pack("bKash app transactions", rows, "  5.6s login screen: typing the saved PIN slowly\n 19.0s the box shows all 5 digits")
        assertTrue(out.size <= 12)
        assertTrue(out.sumOf { it.length } <= AppReader.TOTAL_CHARS)
        assertTrue(out.last().startsWith(AppReader.TRACE_MARK))
        // The log is never read as a row: no " | " in it.
        assertFalse(out.last().contains(" | "))
        assertTrue(out.dropLast(1).drop(1).all { it.contains(" | ") })
        // Without a log nothing changes.
        assertFalse(AppReader.pack("h", rows).last().startsWith(AppReader.TRACE_MARK))
    }
}

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
}

package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The admin code (2026-11-03): what is accepted, that only the right code opens the lock, and that wrong guesses are
 *  slowed down. The Android parts (the saved record, the open window) are thin wrappers around exactly these. */
class AdminLockTest {
    // Few rounds so the tests are quick; the stored format records the number, and the real ones use many more.
    private val rounds = 1_000
    private val salt = ByteArray(16) { it.toByte() }

    @Test fun aGoodCodeIsAccepted() {
        assertNull(AdminCode.problem("483920"))
        assertNull(AdminCode.problem("483920174355"))
    }

    @Test fun weakOrWrongShapedCodesAreRefusedWithAReason() {
        assertEquals("Use at least 6 digits.", AdminCode.problem("48392"))
        assertEquals("Use at most 12 digits.", AdminCode.problem("1234567890123"))
        assertEquals("Use digits only.", AdminCode.problem("48392a"))
        assertEquals("Do not use one digit repeated.", AdminCode.problem("111111"))
        assertEquals("Do not use a run of digits such as 123456.", AdminCode.problem("123456"))
        assertEquals("Do not use a run of digits such as 123456.", AdminCode.problem("987654"))
    }

    @Test fun onlyTheRightCodeMatches() {
        val stored = AdminCode.encode("483920", salt, rounds)
        assertTrue(AdminCode.matches("483920", stored))
        assertFalse(AdminCode.matches("483921", stored))
        assertFalse(AdminCode.matches("", stored))
        assertFalse(AdminCode.matches("48392", stored))
    }

    @Test fun theCodeItselfIsNeverInTheStoredRecord() {
        val stored = AdminCode.encode("483920", salt, rounds)
        assertFalse(stored.contains("483920"))
        assertTrue(stored.startsWith("v1:$rounds:"))
    }

    @Test fun twoPhonesWithTheSameCodeStoreDifferentRecords() {
        // A fresh random salt each time, so one leaked record says nothing about another phone's.
        assertNotEquals(AdminCode.encode("483920", iterations = rounds), AdminCode.encode("483920", iterations = rounds))
    }

    @Test fun aDamagedRecordNeverMatchesAndNeverCrashes() {
        assertFalse(AdminCode.matches("483920", ""))
        assertFalse(AdminCode.matches("483920", "garbage"))
        assertFalse(AdminCode.matches("483920", "v2:1000:AA==:AA=="))
        assertFalse(AdminCode.matches("483920", "v1:notanumber:AA==:AA=="))
        // An absurd round count is refused rather than used to freeze the phone.
        assertFalse(AdminCode.matches("483920", "v1:2000000000:AA==:AA=="))
    }

    @Test fun wrongGuessesAreSlowedDown() {
        // Free tries first, then a wait that grows, and never more than six hours.
        assertEquals(0L, AdminThrottle.waitAfter(1))
        assertEquals(0L, AdminThrottle.waitAfter(4))
        assertEquals(5 * 60_000L, AdminThrottle.waitAfter(5))
        assertEquals(0L, AdminThrottle.waitAfter(6))
        assertEquals(10 * 60_000L, AdminThrottle.waitAfter(10))
        assertEquals(20 * 60_000L, AdminThrottle.waitAfter(15))
        assertEquals(AdminThrottle.MAX_MS, AdminThrottle.waitAfter(500))
    }

    @Test fun theWaitCountsDownAndEndsAndTriesLeftIsHonest() {
        assertEquals(60_000L, AdminThrottle.remaining(lockedUntil = 160_000L, now = 100_000L))
        assertEquals(0L, AdminThrottle.remaining(lockedUntil = 100_000L, now = 160_000L))
        assertEquals(4, AdminThrottle.triesLeft(1))
        assertEquals(1, AdminThrottle.triesLeft(4))
        // Rounded UP, so the screen never says "0 minutes" while still refusing.
        assertEquals(1, AdminThrottle.minutes(1))
        assertEquals(5, AdminThrottle.minutes(5 * 60_000L))
        assertEquals(6, AdminThrottle.minutes(5 * 60_000L + 1))
    }
}

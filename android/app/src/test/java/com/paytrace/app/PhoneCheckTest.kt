package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneCheckTest {
    @Test fun standbyBucketsAreExplainedInPlainWords() {
        assertEquals(PhoneCheck.Level.GOOD, PhoneCheck.bucketLine(10).level)
        assertEquals(PhoneCheck.Level.GOOD, PhoneCheck.bucketLine(20).level)
        assertEquals(PhoneCheck.Level.WARN, PhoneCheck.bucketLine(30).level)
        assertEquals(PhoneCheck.Level.BAD, PhoneCheck.bucketLine(40).level)
        assertEquals(PhoneCheck.Level.BAD, PhoneCheck.bucketLine(45).level)
        assertEquals(PhoneCheck.Level.UNKNOWN, PhoneCheck.bucketLine(null).level)
        assertEquals(PhoneCheck.Level.UNKNOWN, PhoneCheck.bucketLine(50).level)
    }

    @Test fun batteryAndBackgroundLines() {
        assertEquals(PhoneCheck.Level.GOOD, PhoneCheck.batteryLine(true).level)
        assertEquals(PhoneCheck.Level.BAD, PhoneCheck.batteryLine(false).level)
        assertEquals(PhoneCheck.Level.GOOD, PhoneCheck.restrictedLine(false).level)
        assertEquals(PhoneCheck.Level.BAD, PhoneCheck.restrictedLine(true).level)
        assertEquals(PhoneCheck.Level.UNKNOWN, PhoneCheck.restrictedLine(null).level)
    }
}

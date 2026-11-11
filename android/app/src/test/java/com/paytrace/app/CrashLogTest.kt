package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashLogTest {
    @Test fun theReportNamesThePhoneAndTheError() {
        val r = CrashLog.format(0L, "1.0.205", "realme", "RMX2189", "10", 29, "main",
            "java.security.ProviderException: Keystore operation failed\n\tat com.paytrace.app.SecretStore.set")
        assertTrue(r.startsWith("PayTrace 1.0.205 crashed at "))
        assertTrue(r.contains("realme RMX2189, Android 10 (API 29), thread main"))
        assertTrue(r.contains("ProviderException: Keystore operation failed"))
    }

    @Test fun aHugeTraceIsCut() {
        val r = CrashLog.format(0L, "1", "m", "x", "10", 29, "t", "e".repeat(50_000))
        assertEquals(CrashLog.MAX_CHARS, r.length)
    }
}

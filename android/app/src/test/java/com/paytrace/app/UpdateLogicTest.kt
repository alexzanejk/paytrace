package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateLogicTest {
    private val sha = "a".repeat(64)
    private fun json(code: Int = 65, apk: String = "paytrace-65.apk", sha256: String = sha, size: Long = 7_000_000, notes: String = "Fixes") =
        """{"version_code":$code,"apk":"$apk","sha256":"$sha256","size":$size,"notes":"$notes"}"""

    @Test fun readsAValidFile() {
        val i = UpdateLogic.parse(json(), "https://app.example.com/latest.json")
        assertNotNull(i)
        assertEquals(65, i!!.versionCode)
        assertEquals("1.0.65", i.versionName)
        assertEquals("https://app.example.com/paytrace-65.apk", i.apkUrl)
        assertEquals(sha, i.sha256)
        assertEquals(7_000_000L, i.size)
        assertEquals("Fixes", i.notes)
    }

    @Test fun theDownloadAlwaysSitsBesideLatestJson() {
        val i = UpdateLogic.parse(json(), "https://app.example.com/some/folder/latest.json")!!
        assertEquals("https://app.example.com/some/folder/paytrace-65.apk", i.apkUrl)
    }

    @Test fun aFileNamedForAnotherVersionIsIgnored() {
        assertNull(UpdateLogic.parse(json(code = 65, apk = "paytrace-64.apk")))
    }

    @Test fun pathsAndOtherNamesAreIgnored() {
        assertNull(UpdateLogic.parse(json(apk = "../paytrace-65.apk")))
        assertNull(UpdateLogic.parse(json(apk = "https://evil.example/paytrace-65.apk")))
        assertNull(UpdateLogic.parse(json(apk = "other-65.apk")))
        assertNull(UpdateLogic.parse(json(apk = "paytrace-65.apk/../x")))
    }

    @Test fun aBadChecksumIsIgnored() {
        assertNull(UpdateLogic.parse(json(sha256 = "abc")))
        assertNull(UpdateLogic.parse(json(sha256 = "z".repeat(64))))
    }

    @Test fun anUpperCaseChecksumIsAccepted() {
        val i = UpdateLogic.parse(json(sha256 = "A".repeat(64)))
        assertEquals(sha, i!!.sha256)
    }

    @Test fun absurdSizesAreIgnored() {
        assertNull(UpdateLogic.parse(json(size = 0)))
        assertNull(UpdateLogic.parse(json(size = UpdateLogic.MAX_APK_BYTES + 1)))
    }

    @Test fun versionZeroAndJunkAreIgnored() {
        assertNull(UpdateLogic.parse(json(code = 0, apk = "paytrace-0.apk")))
        assertNull(UpdateLogic.parse("not json"))
        assertNull(UpdateLogic.parse("{}"))
        assertNull(UpdateLogic.parse(""))
    }

    @Test fun onlyHttpsAddressesAreTrusted() {
        assertNull(UpdateLogic.parse(json(), "http://app.example.com/latest.json"))
    }

    @Test fun notesAreTidiedAndShortened() {
        val i = UpdateLogic.parse(json(notes = "a".repeat(500)))!!
        assertEquals(300, i.notes.length)
        val j = UpdateLogic.parse("""{"version_code":65,"apk":"paytrace-65.apk","sha256":"$sha","size":10,"notes":"x\ny"}""")!!
        assertEquals("x y", j.notes)
    }

    @Test fun onlyANewerVersionIsOffered() {
        val i = UpdateLogic.parse(json())!!
        assertTrue(UpdateLogic.isNewer(i, 64))
        assertFalse(UpdateLogic.isNewer(i, 65))
        assertFalse(UpdateLogic.isNewer(i, 70))
    }

    @Test fun checksAreSpacedSixHoursApartUnlessForced() {
        val hour = 3_600_000L
        val t = 1_000_000_000_000L
        assertTrue(UpdateLogic.dueForCheck(0L, t))
        assertFalse(UpdateLogic.dueForCheck(t - hour, t))
        assertFalse(UpdateLogic.dueForCheck(t - 5 * hour, t))
        assertTrue(UpdateLogic.dueForCheck(t - 6 * hour, t))
        assertTrue(UpdateLogic.dueForCheck(t - hour, t, force = true))
        assertTrue("a clock that went backwards counts as due", UpdateLogic.dueForCheck(t + hour, t))
    }

    @Test fun hexIsLowerCaseAndPadded() {
        assertEquals("000fff10", UpdateLogic.hex(byteArrayOf(0x00, 0x0f, 0xff.toByte(), 0x10)))
    }
}

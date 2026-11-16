package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfInstallTest {
    @Test
    fun androidsAnswersInPlainWords() {
        assertEquals("Tap Install on the next screen.", InstallWords.text(InstallWords.PENDING_USER_ACTION))
        assertTrue(InstallWords.text(InstallWords.SUCCESS).startsWith("Updated"))
        assertTrue(InstallWords.text(InstallWords.ABORTED).contains("cancelled"))
        assertTrue(InstallWords.text(5).contains("does not match"))
        assertTrue(InstallWords.text(6).contains("space"))
        assertTrue(InstallWords.text(99).contains("did not install"))
    }

    @Test
    fun theWordsUseAndroidsOwnNumbers() {
        // Pinned to Android's PackageInstaller.STATUS_* values, which never change.
        assertEquals(-1, InstallWords.PENDING_USER_ACTION)
        assertEquals(0, InstallWords.SUCCESS)
        assertEquals(3, InstallWords.ABORTED)
    }
}

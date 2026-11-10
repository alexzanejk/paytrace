package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bKash-app reader (test step, owner 2026-11-10): only bKash windows, never a PIN, and a long list packed so it fits
 *  what command_result can carry. */
class AppRecorderTest {
    @Test fun onlyBkashPackages() {
        assertTrue(AppRecorder.isBkash("com.bKash.agentapp"))
        assertFalse(AppRecorder.isBkash("com.whatsapp"))
        assertFalse(AppRecorder.isBkash(null))
    }

    @Test fun aPinIsNeverKept() {
        val pinScreen = listOf("পিন দিন", "12345", "১২৩৪৫", "••••", "1", "2", "3")
        assertEquals(listOf("পিন দিন", "••••", "1", "2", "3"), AppRecorder.safeLines(pinScreen))
        // Away from a PIN screen, numbers stay (amounts, times, TrxIDs).
        assertEquals(listOf("ক্যাশ আউট", "12345"), AppRecorder.safeLines(listOf("ক্যাশ আউট", " ", "12345")))
    }

    @Test fun scrollingKeepsOnlyTheNewLines() {
        val a = listOf("A", "B", "C", "D")
        val b = listOf("C", "D", "E", "F")
        assertEquals(listOf("E", "F"), AppRecorder.newPart(a, b))
        assertEquals(listOf("X", "Y"), AppRecorder.newPart(a, listOf("X", "Y")))
    }

    @Test fun packingFitsTheCommandResult() {
        val screens = List(40) { i -> "screen $i " + "x".repeat(900) }
        val out = AppRecorder.pack("bKash app read (test)", screens)
        assertTrue(out.size <= AppRecorder.CHUNKS)
        assertTrue(out.all { it.length <= AppRecorder.CHUNK_CHARS })
        // The server refuses a message over 20,000 characters; the whole answer stays well under it.
        assertTrue(out.sumOf { it.length } <= AppRecorder.TOTAL_CHARS)
        assertTrue(out[0].contains("screens: 40"))
        val few = AppRecorder.pack("h", listOf("a", "b"))
        assertEquals(listOf("h\nscreens: 2, sent: 2", "a\n=====\nb"), few)
        assertTrue(out[1].startsWith("screen 0 "))
        // Too many to send: the first two and the LAST screens are kept, the middle is left out and said so.
        val all = out.drop(1).joinToString("")
        assertTrue(all.contains("screen 39 "))
        assertTrue(all.contains("screens in the middle left out"))
    }

    @Test fun anElementKeepsItsHiddenNameFlagsAndPlace() {
        val l = AppRecorder.nodeLine(2, "android.widget.Button", "com.bkash.businessapp:id/btnLogin", "লগ ইন", null, null, "c", "10,20,300,80")
        assertEquals("  Button#btnLogin \"লগ ইন\" <c> @10,20,300,80", l)
        // A typing box shows its hint; a description equal to the words is not repeated.
        assertEquals("EditText {সার্চ করুন} <ce>", AppRecorder.nodeLine(0, "android.widget.EditText", null, null, null, "সার্চ করুন", "ce", null))
        assertEquals("TextView \"A\"", AppRecorder.nodeLine(0, "android.widget.TextView", null, "A", "A", null, "", null))
    }

    @Test fun theSameScreenStillMovingIsNotSentAgain() {
        val a = listOf("Button \"X\" <c> @0,0,10,10", "TextView \"Y\" @0,20,10,30")
        val b = listOf("Button \"X\" <c> @0,5,10,15", "TextView \"Y\" @0,25,10,35")
        assertEquals(AppRecorder.signature(a), AppRecorder.signature(b))
        assertFalse(AppRecorder.signature(a) == AppRecorder.signature(listOf("Button \"Z\" <c> @0,0,10,10")))
    }

    @Test fun aScreenFitsOneMessage() {
        val many = (1..2000).map { "TextView \"row $it\" @0,0,1,1" }
        val t = AppRecorder.screenText(3, 12, "com.bkash.businessapp", listOf("com.android.systemui"), many)
        assertTrue(t.length <= AppRecorder.SCREEN_CHARS)
        assertTrue(t.startsWith("#3 +12s pkg=com.bkash.businessapp also=com.android.systemui"))
        assertTrue(t.contains("more elements)"))
    }
}

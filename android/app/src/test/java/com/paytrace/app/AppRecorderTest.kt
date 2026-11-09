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
}

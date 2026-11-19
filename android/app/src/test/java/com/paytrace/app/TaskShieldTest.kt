package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskShieldTest {
    @Test fun theFreezeIsLiftedForTheLongestStroke() {
        assertEquals(0L, Gestures.lengthOf(emptyList(), emptyList()))
        assertEquals(120L, Gestures.lengthOf(listOf(0L), listOf(120L)))
        // A swipe that continues into a hold: the later stroke decides.
        assertEquals(1_300L, Gestures.lengthOf(listOf(0L, 900L), listOf(900L, 400L)))
        assertTrue(TaskShield.MAX_MS <= 180_000L)
    }

    @Test fun forceStopFindsTheButtonAndItsConfirmInEitherLanguage() {
        assertEquals("force stop", ForceStop.pickButton(listOf("app info", "open", "uninstall", "force stop", "storage")))
        assertEquals("জোর করে বন্ধ করুন", ForceStop.pickButton(listOf("অ্যাপের তথ্য", "আনইনস্টল করুন", "জোর করে বন্ধ করুন")))
        assertNull(ForceStop.pickButton(listOf("app info", "open", "uninstall")))
        // The confirm prefers the dialog's own "Force stop" over a plain OK, and takes OK when that is all there is.
        assertEquals("force stop", ForceStop.pickConfirm(listOf("force stop?", "if you force stop an app, it may misbehave.", "cancel", "force stop")))
        assertEquals("ok", ForceStop.pickConfirm(listOf("force stop?", "cancel", "ok")))
        assertNull(ForceStop.pickConfirm(listOf("cancel")))
    }
}

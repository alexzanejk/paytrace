package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test fun theLiftStartsBeforeTheTapAndOutlastsIt() {
        // The Vivo, 2026-11-19 23:07: a tap sent in the same instant as the lift met the glass still solid.
        assertEquals(Gestures.LEAD_MS + 90L + TaskShield.LIFT_MARGIN_MS, Gestures.liftFor(90L))
        assertTrue(Gestures.LEAD_MS >= 100L)
    }

    @Test fun overlappingLiftsKeepTheLaterEndNeverAnEarlierOne() {
        val c = TaskShield.LiftClock()
        assertFalse(c.lifted(1_000))
        c.extend(1_000, 1_300)                  // a swipe: lifted until 2,300
        c.extend(1_100, 500)                    // a short tap inside it: the end must NOT move back to 1,600
        assertEquals(2_300L, c.until)
        assertTrue(c.lifted(2_000))
        assertEquals(300L, c.dueIn(2_000))
        assertFalse(c.lifted(2_300))
        assertEquals(0L, c.dueIn(2_500))
        c.extend(2_500, 400)                    // a later lift moves the end forward
        assertEquals(2_900L, c.until)
        c.reset()
        assertFalse(c.lifted(0))
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

    @Test fun aStuckRunIsClosedFullyAndStartedAgainOnce() {
        // Stuck before any money step: close the app fully and start over, once.
        assertEquals(AppRestart.Step.RESTART, AppRestart.plan(AppRestart.CODE, true, false))
        // The second try stuck again: closed fully, reported as stuck, never a third.
        assertEquals(AppRestart.Step.CLOSE, AppRestart.plan(AppRestart.CODE, true, true))
        // Cut off after a step that may have moved money: closed fully for the next task, never started again by itself.
        assertEquals(AppRestart.Step.CLOSE, AppRestart.plan("no_answer_after_hold", true, false))
        assertEquals(AppRestart.Step.CLOSE, AppRestart.plan("app_stopped_before_send", true, false))
        assertEquals(AppRestart.Step.CLOSE, AppRestart.plan("unexpected_screen", true, false))
        assertEquals(AppRestart.Step.CLOSE, AppRestart.plan("login_failed", true, false))
        // A clean end, a refusal by the wallet, or a phone that could not even start: nothing to close.
        assertEquals(AppRestart.Step.NONE, AppRestart.plan(null, true, false))
        assertEquals(AppRestart.Step.NONE, AppRestart.plan("wallet_refused", true, false))
        assertEquals(AppRestart.Step.NONE, AppRestart.plan("phone_locked", true, false))
        assertEquals(AppRestart.Step.NONE, AppRestart.plan("no_pin", true, false))
        // Another full close is already under way on this phone: report as it is.
        assertEquals(AppRestart.Step.NONE, AppRestart.plan(AppRestart.CODE, false, false))
        // What the dashboard sees for a stuck run that was not started over.
        assertEquals("unexpected_screen", AppRestart.reported(UssdOutcome(false, null, AppRestart.CODE)).error)
        assertEquals("app_closed", AppRestart.reported(UssdOutcome(false, null, "app_closed")).error)
    }
}

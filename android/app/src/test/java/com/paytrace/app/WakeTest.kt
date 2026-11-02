package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Test

/** When a dashboard command may drive this phone, and when it must stop and say so.
 *
 *  The one thing these tests exist to protect: a phone with a REAL lock (PIN, pattern, password, fingerprint) is
 *  never pretended to be workable. Android does not let any app open a locked phone, and a command that quietly
 *  times out instead of saying that would have the owner chasing a fault that is not there. */
class WakeTest {
    private fun decide(interactive: Boolean, locked: Boolean, secure: Boolean) =
        ScreenGate.decide(interactive, locked, secure)

    @Test fun awakeAndUnlockedIsReady() {
        assertEquals(ScreenGate.State.READY, decide(interactive = true, locked = false, secure = false))
        // A phone that HAS a PIN but is already unlocked and in use is perfectly workable.
        assertEquals(ScreenGate.State.READY, decide(interactive = true, locked = false, secure = true))
    }

    @Test fun asleepWithNoRealLockIsJustAsleep() {
        // Screen off, no lock worth the name: PayTrace may wake it and carry on.
        assertEquals(ScreenGate.State.WAKE_NEEDED, decide(interactive = false, locked = false, secure = false))
        // "Swipe" shows a lock screen but secures nothing, so it may be pushed aside.
        assertEquals(ScreenGate.State.WAKE_NEEDED, decide(interactive = true, locked = true, secure = false))
        assertEquals(ScreenGate.State.WAKE_NEEDED, decide(interactive = false, locked = true, secure = false))
    }

    @Test fun arealLockStopsTheRunHoweverTheScreenIs() {
        assertEquals(ScreenGate.State.LOCKED_SECURE, decide(interactive = false, locked = true, secure = true))
        // Screen on but still showing the lock screen: the dialer is behind it, so nothing can be read or pressed.
        assertEquals(ScreenGate.State.LOCKED_SECURE, decide(interactive = true, locked = true, secure = true))
    }

    @Test fun aPhoneThatWasJustWokenOpensTheDialerFromTheWakeWindow() {
        // The owner's Redmi (2026-11-02) lit its screen for a dashboard command and then stopped. MIUI will not let a
        // background service open another app's screen while nothing of ours is in front, so the dialer is opened BY
        // the wake window, which is. The extra the window looks for is the one the runner puts there.
        assertEquals("paytrace.then", ScreenWake.EXTRA_THEN)
        // Opened a touch later than a bare wake, so the lock screen is gone before the dialer is drawn behind it.
        assertEquals(true, WakeActivity.OPEN_MS > WakeActivity.CLOSE_MS)
        // And the whole wake step is given longer than the window takes to do it.
        assertEquals(true, ScreenWake.WAKE_MS > WakeActivity.OPEN_MS)
    }

    @Test fun theOwnerIsToldWhatToDoAboutIt() {
        val said = UssdText.error("phone_locked")
        // It must name the cause and the fix, not just fail.
        assertEquals(true, said.contains("screen lock"))
        assertEquals(true, said.contains("Unlock") || said.contains("unlock"))
    }
}

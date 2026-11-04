package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The list of switched-on accessibility services. Putting PayTrace back must never disturb what else is in it. */
class HealTest {
    private val me = "com.paytrace.app/com.paytrace.app.UssdAccessibilityService"
    private val talkback = "com.google.android.marvin.talkback/com.google.android.accessibility.accessibilitymenu.AccessibilityMenuService"
    private val anydesk = "com.anydesk.adcontrol.ad1/com.anydesk.adcontrol.AccService"

    @Test fun ourServiceIsAddedWithoutLosingAnyOther() {
        // The real list from the owner's Vivo, with PayTrace switched off by an app update.
        assertEquals("$talkback:$anydesk:$me", AccessibilityList.withService("$talkback:$anydesk", me))
        assertEquals(me, AccessibilityList.withService("", me))
        assertEquals(me, AccessibilityList.withService(null, me))
    }

    @Test fun itIsNeverListedTwice() {
        val already = "$talkback:$me"
        assertTrue(AccessibilityList.has(already, me))
        assertEquals(already, AccessibilityList.withService(already, me))
        // Android writes the same name whatever the letter case.
        assertTrue(AccessibilityList.has(already.uppercase(), me))
    }

    @Test fun takingOurServiceOutKeepsEveryOther() {
        assertEquals("$talkback:$anydesk", AccessibilityList.withoutService("$talkback:$me:$anydesk", me))
        assertEquals("$talkback:$anydesk", AccessibilityList.withoutService("$talkback:${me.uppercase()}:$anydesk", me))
        assertEquals("", AccessibilityList.withoutService(me, me))
        assertEquals("$talkback", AccessibilityList.withoutService(talkback, me))
        assertEquals("", AccessibilityList.withoutService(null, me))
        // Out and back in is the OFF/ON that makes Android start a service it had given up on.
        assertEquals("$talkback:$anydesk:$me", AccessibilityList.withService(AccessibilityList.withoutService("$talkback:$me:$anydesk", me), me))
    }

    /** When a listed-but-dead service is switched off and on by the app. */
    @Test fun repairOnlyWhenListedDeadAllowedIdleAndOldEnough() {
        val t = 100_000L
        fun due(listed: Boolean = true, connected: Boolean = false, allowed: Boolean = true, busy: Boolean = false, deadSince: Long = t - 11_000, lastTry: Long = 0L, now: Long = t, minDead: Long = RepairPolicy.DEAD_MS, retry: Long = RepairPolicy.RETRY_MS) =
            RepairPolicy.due(listed, connected, allowed, busy, deadSince, lastTry, now, minDead, retry)
        assertTrue(due())
        assertTrue(!due(listed = false))                     // switched off: that is AccessibilityHeal's job, or the owner's
        assertTrue(!due(connected = true))                   // running: nothing to mend
        assertTrue(!due(allowed = false))                    // no adb grant: Android would refuse the write
        assertTrue(!due(busy = true))                        // never under a running command
        assertTrue(!due(deadSince = 0L))                     // not yet noticed as dead
        assertTrue(!due(deadSince = t - 3_000))              // Android may still be starting it
        assertTrue(due(deadSince = t - 3_000, minDead = 0L)) // before a command the wait is skipped
        assertTrue(!due(lastTry = t - 60_000))               // tried a minute ago from the heartbeat: wait five
        assertTrue(due(lastTry = t - 6 * 60_000))
        assertTrue(due(lastTry = t - 1_000, retry = 0L))     // by hand: always
    }

    @Test fun aListWithGapsIsTidiedRatherThanBroken() {
        assertEquals("$talkback:$me", AccessibilityList.withService(":$talkback: :", me))
        assertTrue(!AccessibilityList.has(":$talkback:", me))
        assertTrue(!AccessibilityList.has(null, me))
    }
}

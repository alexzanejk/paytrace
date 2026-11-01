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

    @Test fun aListWithGapsIsTidiedRatherThanBroken() {
        assertEquals("$talkback:$me", AccessibilityList.withService(":$talkback: :", me))
        assertTrue(!AccessibilityList.has(":$talkback:", me))
        assertTrue(!AccessibilityList.has(null, me))
    }
}

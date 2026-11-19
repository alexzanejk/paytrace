package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

class TaskGuardTest {
    @Test fun aShortBlinkIsWaitedOut() {
        assertEquals(TaskGuard.Step.WAIT, TaskGuard.decide(1_000, 0, true))
    }

    @Test fun anotherAppIsPutAsideUpToTheLimit() {
        assertEquals(TaskGuard.Step.RECLAIM, TaskGuard.decide(3_000, 0, true))
        assertEquals(TaskGuard.Step.RECLAIM, TaskGuard.decide(3_000, TaskGuard.MAX_RECLAIMS - 1, true))
        assertEquals(TaskGuard.Step.GIVE_UP, TaskGuard.decide(3_000, TaskGuard.MAX_RECLAIMS, true))
    }

    @Test fun neverBroughtBackWhenThatCouldRepeatAMoneyStep() {
        assertEquals(TaskGuard.Step.WAIT, TaskGuard.decide(60_000, 0, false))
        assertEquals(TaskGuard.Step.WAIT, TaskGuard.decide(60_000, TaskGuard.MAX_RECLAIMS, false))
    }

    @Test fun whatTookTheScreenIsNamedPlainly() {
        assertEquals("the home screen", TaskGuard.nameOf("com.miui.home"))
        assertEquals("the home screen", TaskGuard.nameOf("com.google.android.apps.nexuslauncher"))
        assertEquals("the notification shade", TaskGuard.nameOf("com.android.systemui"))
        assertEquals("com.whatsapp", TaskGuard.nameOf("com.whatsapp"))
        assertEquals("nothing readable", TaskGuard.nameOf(null))
        assertTrue(TaskGuard.nameOf("android").contains("Android pop-up"))
    }

    @Test fun onlyAndroidsOwnPopUpsAreClosedWithBack() {
        assertTrue(TaskGuard.isSystemDialog("android"))
        assertFalse(TaskGuard.isSystemDialog("com.android.phone"))
        assertFalse(TaskGuard.isSystemDialog("com.android.systemui"))
        assertFalse(TaskGuard.isSystemDialog(null))
    }

    @Test fun theIntruderSkipsTheTasksOwnAppAndTheKeyboard() {
        val own = setOf("com.bkash.businessapp", "com.paytrace.app")
        assertEquals("com.whatsapp", TaskGuard.intruder(listOf("com.whatsapp", "com.android.systemui"), own))
        assertEquals("com.whatsapp", TaskGuard.intruder(listOf("com.google.android.inputmethod.latin", "com.whatsapp"), own))
        assertEquals("the notification shade", TaskGuard.intruder(listOf("com.android.systemui", "com.bkash.businessapp"), own))
        assertNull(TaskGuard.intruder(listOf("com.bkash.businessapp", "com.paytrace.app"), own))
    }
}

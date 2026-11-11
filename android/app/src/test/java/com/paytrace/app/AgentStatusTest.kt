package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AgentStatusTest {
    // Side menu texts as recorded (run 65408217, 2026-11-11).
    private fun menu(label: String) = listOf("বিকাশ মেন্যু", "English", "এজেন্টের স্ট্যাটাস", label, "হোম",
        "সন্দেহজনক কার্যক্রম রিপোর্ট", "রেফারেল", "অ্যাপ সম্পর্কিত তথ্য", "লগ আউট")

    @Test fun theSideMenuSaysOpenOrClosed() {
        assertEquals(true, AgentStatusRead.drawerStatus(menu("খোলা")))
        assertEquals(false, AgentStatusRead.drawerStatus(menu("বন্ধ")))
        assertNull(AgentStatusRead.drawerStatus(listOf("ক্যাশ ইন", "বিটুবি ট্রান্সফার", "হোম")))
        assertNull(AgentStatusRead.drawerStatus(listOf("স্ট্যাটাস পরিবর্তন করুন", "পরিবর্তন করুন")))
    }

    @Test fun theStatusSwitchIsNeverTheLanguageSwitch() {
        // Recorded: title "এজেন্টের স্ট্যাটাস" at y 375..405 (middle 390); English switch 260..298 (279), status switch 371..409 (390).
        assertEquals(1, AgentStatusRead.pickSwitch(390, listOf(279, 390)))
        assertEquals(0, AgentStatusRead.pickSwitch(390, listOf(390, 279)))
        assertNull(AgentStatusRead.pickSwitch(390, listOf(279)))
        assertNull(AgentStatusRead.pickSwitch(390, emptyList()))
    }
}

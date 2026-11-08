package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonalAccountsTest {
    @Test fun agentAndPersonalMustBeOnDifferentSims() {
        assertTrue(PersonalAccounts.clash("01704241450", 0, 0))
        assertFalse(PersonalAccounts.clash("01704241450", 0, 1))
        // No agent number saved: the agent claims no SIM.
        assertFalse(PersonalAccounts.clash("", 0, 0))
    }

    private val agents = listOf(
        Triple("bkash", "01704241450", Pair(0, true)),
        Triple("nagad", "", Pair(0, false)),
        Triple("rocket", "01900000000", Pair(1, false)),
    )
    private val personal = listOf(Triple("bkash", "01800000000", 1), Triple("nagad", "01600000000", -1))

    @Test fun everyAccountSaysWhichKindItIs() {
        val a = PersonalAccounts.walletsJson(agents, personal, true)
        assertEquals(3, a.length())
        assertEquals("agent", a.getJSONObject(0).getString("kind"))
        assertEquals("rocket", a.getJSONObject(1).getString("provider"))
        val p = a.getJSONObject(2)
        assertEquals("personal", p.getString("kind"))
        assertEquals("01800000000", p.getString("number"))
        assertEquals(1, p.getInt("slot"))
    }

    @Test fun personalAccountsAreLeftOutWhileNotAllowed() {
        val a = PersonalAccounts.walletsJson(agents, personal, false)
        assertEquals(2, a.length())
        for (i in 0 until a.length()) assertEquals("agent", a.getJSONObject(i).getString("kind"))
    }
}

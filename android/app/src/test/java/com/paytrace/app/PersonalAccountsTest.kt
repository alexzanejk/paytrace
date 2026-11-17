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
    private val personal = listOf(PersonalEntry("bkash", "01800000000", 1), PersonalEntry("nagad", "01600000000", -1))

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

    @Test fun twoPersonalAccountsOfOneWalletAreBothSentAndOneSaysItIsInTheApp() {
        val two = listOf(
            PersonalEntry("bkash", "01811111111", 0),
            PersonalEntry("bkash", "01822222222", 1, inApp = true),
        )
        val a = PersonalAccounts.walletsJson(emptyList(), two, true)
        assertEquals(2, a.length())
        assertEquals("01811111111", a.getJSONObject(0).getString("number"))
        assertFalse(a.getJSONObject(0).has("app"))
        assertTrue(a.getJSONObject(1).getBoolean("app"))
        assertEquals(1, a.getJSONObject(1).getInt("slot"))
    }

    @Test fun aSimHeldByAnyOtherAccountOfTheWalletIsTaken() {
        val others = listOf("01704241450" to 0, "" to 1)
        assertTrue(PersonalAccounts.taken(others, 0))
        // The other personal account has no number yet, so it claims no SIM.
        assertFalse(PersonalAccounts.taken(others, 1))
        assertTrue(PersonalAccounts.taken(listOf("" to 0, "01811111111" to 1), 1))
    }

    @Test fun eachPersonalAccountSaysWhichOneItIs() {
        val two = listOf(PersonalEntry("bkash", "01811111111", 0, n = 1), PersonalEntry("bkash", "01822222222", 1, n = 2))
        val a = PersonalAccounts.walletsJson(agents, two, true)
        assertFalse(a.getJSONObject(0).has("n")) // an agent account has none
        assertEquals(1, a.getJSONObject(2).getInt("n"))
        assertEquals(2, a.getJSONObject(3).getInt("n"))
    }

    @Test fun aCommandNamesAccountTwoOnlyByExactlyTwo() {
        assertEquals(2, PersonalAccounts.accountOf(2))
        assertEquals(1, PersonalAccounts.accountOf(1))
        assertEquals(1, PersonalAccounts.accountOf(0))
        assertEquals(1, PersonalAccounts.accountOf(3))
    }
}

package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SimSlotTest {
    private val subToSlot: (Int) -> Int? = { sub -> mapOf(1 to 0, 2 to 1)[sub] }

    @Test fun androidsOwnSubscriptionExtraIsTranslatedToTheSlot() {
        assertEquals(1, SimSlot.resolve(mapOf(SimSlot.EXTRA_SUBSCRIPTION_INDEX to 2), subToSlot))
        assertEquals(0, SimSlot.resolve(mapOf("subscription" to 1), subToSlot))
    }

    @Test fun aKeyThatNamesTheSlotItselfWins() {
        assertEquals(1, SimSlot.resolve(mapOf("slot" to 1, SimSlot.EXTRA_SUBSCRIPTION_INDEX to 1), subToSlot))
    }

    @Test fun thePhoneIdIsTheLastResort() {
        assertEquals(1, SimSlot.resolve(mapOf("phone" to 1), subToSlot))
        // A subscription id that translates wins over the phone id; the phone id only speaks when nothing else does.
        assertEquals(1, SimSlot.resolve(mapOf("phone" to 0, "subscription" to 2), subToSlot))
        assertEquals(0, SimSlot.resolve(mapOf("phone" to 0, "subscription" to 9), subToSlot))
    }

    @Test fun textValuesAreReadToo() {
        assertEquals(1, SimSlot.resolve(mapOf("subscription" to "2"), subToSlot))
    }

    @Test fun anUnknownSubscriptionOrAnImpossibleSlotGivesNothing() {
        assertNull(SimSlot.resolve(mapOf("subscription" to 9), subToSlot))
        assertNull(SimSlot.resolve(mapOf("slot" to 5), subToSlot))
        assertNull(SimSlot.resolve(mapOf("subscription" to -1), subToSlot))
        assertNull(SimSlot.resolve(emptyMap(), subToSlot))
        assertNull(SimSlot.resolve(mapOf("slot" to "x"), subToSlot))
    }

    @Test fun aMessageKeepsItsSlotThroughTheCatchUpSelection() {
        val rows = listOf(CatchUp.InboxRow("bKash", "Cash Out Tk 500.00 from 0171 TrxID ABCDEF1234", 1_000L, subId = 2))
        val picked = CatchUp.select(rows, 0L, { if (it == "bKash") "bkash" else null }, { true })
        assertEquals(2, picked.items.single().subId)
    }
}

package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppBalanceTest {
    // Home as recorded (runs 573a9296 and 41cae20d, 2026-11-11): the pill, the figure after a tap, a transaction row.
    private val pid = "com.bkash.businessapp:id/"
    private fun home(figure: String?) = listOfNotNull(
        "${pid}tag_balance" to null,
        "${pid}tag_tap_for_balance" to null,
        figure?.let { "${pid}tag_balance_amount" to it },
        "" to "Tap for Balance",
        "${pid}tag_transaction_item_amount" to "- ৳250",
    )

    @Test fun theFigureIsReadFromTheAmountViewOnly() {
        assertEquals(11923.83, AppBalanceRead.shown(home("11,923.83"))!!, 0.001)
        assertEquals(11674.77, AppBalanceRead.shown(home("11,674.77"))!!, 0.001)
        // Before the tap only the words show; a transaction row's "- ৳250" is never the balance.
        assertNull(AppBalanceRead.shown(home(null)))
    }

    @Test fun figuresInEitherWritingAreRead() {
        assertEquals(11923.83, AppBalanceRead.amount("৳ 11,923.83")!!, 0.001)
        assertEquals(1570.78, AppBalanceRead.amount("১,৫৭০.৭৮")!!, 0.001)
        assertEquals(0.0, AppBalanceRead.amount("0.00")!!, 0.001)
        assertNull(AppBalanceRead.amount("Tap for Balance"))
        assertNull(AppBalanceRead.amount("- ৳250"))
        assertNull(AppBalanceRead.amount(""))
        assertNull(AppBalanceRead.amount(null))
    }

    @Test fun homeIsThePageWithThePill() {
        assertTrue(AppBalanceRead.isHome(home(null).map { it.first }))
        assertFalse(AppBalanceRead.isHome(listOf("${pid}tag_search_box", "${pid}tag_transaction_title")))
    }

    @Test fun tapThenReadAndNeverTakeAnOldFigureAtOnce() {
        assertEquals(AppBalanceRead.Step.TAP, AppBalanceRead.next(visible = false, tapped = false, sinceTap = 0, taps = 0, onHome = 0))
        assertEquals(AppBalanceRead.Step.WAIT, AppBalanceRead.next(false, true, 2_000, 1, 3_000))
        assertEquals(AppBalanceRead.Step.READ, AppBalanceRead.next(true, true, 2_000, 1, 3_000))
        // Already showing before PayTrace's own tap: waited out, then taken with a note.
        assertEquals(AppBalanceRead.Step.WAIT, AppBalanceRead.next(true, false, 0, 0, 3_000))
        assertEquals(AppBalanceRead.Step.READ_OLD, AppBalanceRead.next(true, false, 0, 0, AppBalanceRead.STALE_WAIT_MS))
        // No figure after a tap: tapped again, at most three times.
        assertEquals(AppBalanceRead.Step.TAP, AppBalanceRead.next(false, true, AppBalanceRead.SHOW_WAIT_MS, 1, 9_000))
        assertEquals(AppBalanceRead.Step.GIVE_UP, AppBalanceRead.next(false, true, AppBalanceRead.SHOW_WAIT_MS, AppBalanceRead.TAPS, 30_000))
    }
}

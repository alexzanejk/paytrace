package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The cash-in walk. Built from the owner's own Nagad recording (2026-11-01), which is the only cash-in PayTrace has
 *  really seen. Every test here is about one thing: money must never move unless the wallet's own screen says, before
 *  the PIN, that it is going to THIS number and is THIS much. */
class CashInTest {
    private val order = CashInOrder("nagad", "01706630756", 100.0)
    private val pin = { "0000" }

    private val mainMenu = "1. Cash In\n2. Register Customer\n3. B2B\n4. Bill Pay\n5. EMI Payment\n6. My Nagad"
    private val askNumber = "Enter Account Number:"
    private val askAmount = "Enter Amount:"
    private val confirm = "Cash In\nTo: 01706630756\nAmount: Tk 100.00\nEnter PIN:"
    private val receipt = "Cash In Tk 100.00 to 01706630756 is successful. TrxID: AB12CD34 Balance: Tk 17,100.42"

    private fun walk(flow: BalanceFlow, vararg screens: String): List<UssdAction> = screens.map { flow.onScreen(it) }

    @Test fun theOwnersOwnCashInWalksThrough() {
        val f = CashInFlow(order, pin)
        val steps = walk(f, mainMenu, askNumber, askAmount, confirm, receipt)
        assertEquals(UssdAction.Reply("1"), steps[0])
        assertEquals(UssdAction.Reply("01706630756"), steps[1])
        assertEquals(UssdAction.Reply("100"), steps[2])
        assertEquals(UssdAction.Reply("0000", secret = true), steps[3])
        val done = steps[4] as UssdAction.Done
        assertEquals("AB12CD34", done.trx)
        assertEquals(17100.42, done.balance, 0.001)
    }

    @Test fun thePinIsNeverTypedUnlessTheScreenShowsThisVeryCashIn() {
        // Someone else's number on the confirmation: stop, with the PIN untouched.
        val other = CashInFlow(order, pin)
        other.onScreen(mainMenu); other.onScreen(askNumber); other.onScreen(askAmount)
        assertEquals(
            UssdAction.Fail("confirm_does_not_match"),
            other.onScreen("Cash In\nTo: 01999888777\nAmount: Tk 100.00\nEnter PIN:"),
        )

        // The right number but the wrong amount: stop.
        val wrongAmount = CashInFlow(order, pin)
        wrongAmount.onScreen(mainMenu); wrongAmount.onScreen(askNumber); wrongAmount.onScreen(askAmount)
        assertEquals(
            UssdAction.Fail("confirm_does_not_match"),
            wrongAmount.onScreen("Cash In\nTo: 01706630756\nAmount: Tk 1,000.00\nEnter PIN:"),
        )

        // A bare PIN prompt that shows neither: stop. (A wallet PayTrace has not seen would land here.)
        val bare = CashInFlow(order, pin)
        bare.onScreen(mainMenu); bare.onScreen(askNumber); bare.onScreen(askAmount)
        assertEquals(UssdAction.Fail("confirm_does_not_match"), bare.onScreen("Enter PIN:"))
    }

    @Test fun anyScreenOutOfOrderStopsTheRun() {
        assertEquals(UssdAction.Fail("unexpected_screen"), CashInFlow(order, pin).onScreen(askNumber))
        val f = CashInFlow(order, pin)
        f.onScreen(mainMenu)
        assertEquals(UssdAction.Fail("unexpected_screen"), f.onScreen("Enter Amount:"))
        // A refusal after the PIN is never retried, it just stops.
        val g = CashInFlow(order, pin)
        walk(g, mainMenu, askNumber, askAmount, confirm)
        assertEquals(UssdAction.Fail("unexpected_screen"), g.onScreen("Wrong PIN. Please try again."))
    }

    @Test fun aCommandThePhoneWillNotActOnIsRefusedBeforeAnything() {
        // The phone checks the limits again, so a command that got past the dashboard still cannot move money.
        assertTrue(!CashInOrder("nagad", "01706630756", 10_001.0).sane())
        assertTrue(!CashInOrder("nagad", "0170663075", 100.0).sane())
        assertTrue(!CashInOrder("nagad", "01706630756", 0.0).sane())
        assertTrue(CashInOrder("nagad", "01706630756", 10_000.0).sane())
        assertEquals(
            UssdAction.Fail("bad_cash_in"),
            CashInFlow(CashInOrder("nagad", "01706630756", 99_999.0), pin).onScreen(mainMenu),
        )
    }

    @Test fun theAmountIsTypedTheWayAPersonTypesIt() {
        assertEquals("100", CashInRead.typed(100.0))
        assertEquals("1500", CashInRead.typed(1500.0))
        assertEquals("100.50", CashInRead.typed(100.5))
    }

    @Test fun theReceiptIsOnlyBelievedWhenItSaysSoAndCarriesANumber() {
        assertTrue(CashInRead.succeeded(receipt))
        assertEquals("AB12CD34", CashInRead.trxOn(receipt))
        assertTrue(!CashInRead.succeeded("Cash In Tk 100.00 to 01706630756 failed."))
        assertTrue(!CashInRead.succeeded("successful"))
        assertNull(CashInRead.trxOn("Balance: Tk 100.00"))
    }
}

package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The personal bKash Send Money walk, from the owner's own recording (2026-11-08), screen for screen. */
class SendMoneyTest {
    private val order = CashInOrder("bkash", "01719114383", 850.0)
    private val pin = { "0000" }

    private val menu = "bKash\n1.Send Money\n2.Send Money to Non-bKash User\n3.Mobile Recharge\n4.Payment\n5.Cash Out\n6.Pay Bill\n" +
        "7.Microfinance\n8.Download bKash App\n9.My bKash\n10.Reset PIN"
    private val agentMenu = "bKash\n1 Cash In\n2 B2B Transfer\n3 Pay Bill\n4 My bKash\n5 Helpline"
    private val askNumber = "Enter Receiver bKash Account No:"
    private val askAmount = "FREE Send Money to 5 Priyo Numbers.\nDial *247# and select number 9 to find priyo Numbers.\nEnter Amount:"
    private val askRef = "FREE Send Money to 5 Priyo numbers up to 25,000 Tk. every month.\nEnter Reference:"
    private val confirm = "Add up to 5 Priyo Numbers to Send Money for FREE.\nSend Money.\nTo: 01719114383\nAmount: Tk 850\n" +
        "Reference: PT\nEnter Menu PIN to confirm:"
    private val receipt = "Send Money Tk 850.00 to 01719114383 successful. Ref PT. Fee Tk 10.00. Balance Tk 14,660.08. TrxID DK817GU2FV"

    private fun walk(flow: BalanceFlow, vararg s: String) = s.map { flow.onScreen(it) }

    @Test fun theOwnersRecordingWalksThrough() {
        val steps = walk(SendMoneyFlow(order, pin), menu, askNumber, askAmount, askRef, confirm, receipt)
        assertEquals(UssdAction.Reply("1"), steps[0])
        assertEquals(UssdAction.Reply("01719114383"), steps[1])
        assertEquals(UssdAction.Reply("850"), steps[2])
        assertEquals(UssdAction.Reply(BkashPersonal.REFERENCE), steps[3])
        assertEquals(UssdAction.Reply("0000", secret = true), steps[4])
        val done = steps[5] as UssdAction.Done
        assertEquals("DK817GU2FV", done.trx)
        assertEquals(14660.08, done.balance!!, 0.001)
    }

    @Test fun theAgentMenuStopsTheRunBeforeAnythingIsTyped() {
        assertEquals(UssdAction.Fail("no_personal"), SendMoneyFlow(order, pin).onScreen(agentMenu))
        assertTrue(BkashPersonal.isAgentMenu(agentMenu))
        assertFalse(BkashPersonal.isPersonalMenu(agentMenu))
        assertTrue(BkashPersonal.isPersonalMenu(menu))
    }

    @Test fun thePinIsNeverTypedOnAConfirmationOfAnotherSend() {
        val f = SendMoneyFlow(order, pin)
        walk(f, menu, askNumber, askAmount, askRef)
        assertEquals(UssdAction.Fail("confirm_does_not_match"), f.onScreen(confirm.replace("01719114383", "01719114384")))
        val g = SendMoneyFlow(order, pin)
        walk(g, menu, askNumber, askAmount, askRef)
        assertEquals(UssdAction.Fail("confirm_does_not_match"), g.onScreen(confirm.replace("Tk 850", "Tk 8500")))
    }

    @Test fun aRefusalStopsAndAnUnknownScreenStops() {
        val f = SendMoneyFlow(order, pin)
        walk(f, menu, askNumber)
        assertEquals(UssdAction.Fail("wallet_refused"), f.onScreen("Insufficient balance."))
        val g = SendMoneyFlow(order, pin)
        walk(g, menu, askNumber, askAmount)
        assertEquals(UssdAction.Fail("unexpected_screen"), g.onScreen("Enter Menu PIN:"))
    }

    @Test fun anOpenSessionIsAnsweredNoOnce() {
        val f = SendMoneyFlow(order, pin)
        assertEquals(UssdAction.Reply("2"), f.onScreen("Do you want to continue?\n1 - Yes\n2 - No"))
        assertEquals(UssdAction.Reply("1"), f.onScreen(menu))
    }

    @Test fun onlyBkashAndOnlySaneOrders() {
        assertEquals(UssdAction.Fail("unsupported"), SendMoneyFlow(CashInOrder("nagad", "01719114383", 850.0), pin).onScreen(menu))
        assertEquals(UssdAction.Fail("bad_cash_in"), SendMoneyFlow(CashInOrder("bkash", "0171911438", 850.0), pin).onScreen(menu))
        assertEquals(UssdAction.Fail("bad_cash_in"), SendMoneyFlow(CashInOrder("bkash", "01719114383", 50.0), pin).onScreen(menu))
    }

    @Test fun theReferenceScreenIsNotTakenForTheAmountScreen() {
        assertTrue(BkashPersonal.asksForReference(askRef))
        assertFalse(BkashPersonal.asksForReference(askAmount))
        assertFalse(CashInRead.asksForAmount(askRef))
        assertTrue(CashInRead.asksForAmount(askAmount))
    }
}

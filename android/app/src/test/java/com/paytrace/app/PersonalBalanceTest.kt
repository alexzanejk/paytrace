package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Personal bKash by USSD, from the owner's recording of 2026-11-17 (a Tk 50 Send Money, then a balance check), screen
 *  for screen. The PIN here is a stand-in; the real one never appears in the code. */
class PersonalBalanceTest {
    private val pin = { "0000" }

    private val menu = "bKash\n1.Send Money\n2.Send Money to Non-bKash User\n3.Mobile Recharge\n4.Payment\n5.Cash Out\n6.Pay Bill\n" +
        "7.Microfinance\n8.Download bKash App\n9.My bKash\n10.Reset PIN"
    private val myBkash = "bKash\n1.Check Balance\n2.Request Statement\n3.Change PIN\n4.Priyo Numbers\n5.Save Bill\n6.Update MNP\n" +
        "7.Confirm iPhone Login\n8.iPhone PIN Reset\n9.Helpline\n0.Main Menu"
    private val askPin = "Enter PIN:"
    private val balance = "bKash\nCurrent balance Tk 17,205.08.\nAvailable balance Tk 17,205.08.\n 0. Main Menu"
    private val agentMenu = "bKash\n1 Cash In\n2 B2B Transfer\n3 Pay Bill\n4 My bKash\n5 Helpline"

    private fun walk(flow: BalanceFlow, vararg s: String) = s.map { flow.onScreen(it) }

    @Test fun theRecordingWalksToTheBalance() {
        val steps = walk(PersonalBalanceFlow(pin), menu, myBkash, askPin, balance)
        assertEquals(UssdAction.Reply("9"), steps[0])
        assertEquals(UssdAction.Reply("1"), steps[1])
        assertEquals(UssdAction.Reply("0000", secret = true), steps[2])
        assertEquals(17205.08, (steps[3] as UssdAction.Done).balance!!, 0.001)
    }

    @Test fun progressScreensAreWaitedOut() {
        val flow = PersonalBalanceFlow(pin)
        assertEquals(UssdAction.Wait, flow.onScreen("Initiated USSD session\nUSSD code running..."))
        assertEquals(UssdAction.Reply("9"), flow.onScreen(menu))
    }

    @Test fun theMenuNumbersAreReadFromTheMenu() {
        assertEquals("9", PersonalBalanceRead.myBkash(menu))
        assertEquals("1", PersonalBalanceRead.checkBalance(myBkash))
        val moved = menu.replace("9.My bKash", "7.My bKash").replace("7.Microfinance", "9.Microfinance")
        assertEquals(UssdAction.Reply("7"), PersonalBalanceFlow(pin).onScreen(moved))
        assertNull(PersonalBalanceRead.myBkash("bKash\n1.Send Money\n5.Cash Out"))
    }

    @Test fun theAgentMenuStopsBeforeAnythingIsTyped() {
        assertEquals(UssdAction.Fail("no_personal"), PersonalBalanceFlow(pin).onScreen(agentMenu))
    }

    @Test fun thePinIsNeverTypedOnAMoneyScreen() {
        val flow = PersonalBalanceFlow(pin)
        flow.onScreen(menu)
        flow.onScreen(myBkash)
        val confirm = "Send Money.\nTo: 01320352256\nAmount: Tk 50\nReference: A\nEnter Menu PIN to confirm:"
        assertEquals(UssdAction.Fail("unexpected_screen"), flow.onScreen(confirm))
    }

    @Test fun noSavedPinStopsAtThePinScreen() {
        val steps = walk(PersonalBalanceFlow { "" }, menu, myBkash, askPin)
        assertEquals(UssdAction.Fail("no_pin"), steps[2])
    }

    @Test fun aSendMoneyReceiptIsNotABalance() {
        val flow = PersonalBalanceFlow(pin)
        walk(flow, menu, myBkash, askPin)
        val receipt = "Send Money Tk 50.00 to 01320352256 successful. Ref A. Fee Tk 5.00. Balance Tk 17,205.08. TrxID DKH8KOLCEM"
        assertTrue(flow.onScreen(receipt) is UssdAction.Fail)
    }

    @Test fun theReportLineKeepsItsShape() {
        assertEquals("account 1 01700000000 SIM 2: Tk 17205.08",
            PersonalBalanceReport.line(1, "01700000000", 1, UssdOutcome(true, 17205.08, null)))
        assertEquals("account 2 01800000000 SIM 1: failed no_pin",
            PersonalBalanceReport.line(2, "01800000000", 0, UssdOutcome(false, null, "no_pin")))
    }

    /** The same day's Send Money of Tk 50 (reference typed by hand as "A"; PayTrace types "PT") goes through the
     *  existing flow unchanged. */
    @Test fun theSendMoneyRecordingStillWalksThrough() {
        val order = CashInOrder("bkash", "01320352256", 50.0)
        val confirm = "Add up to 5 Priyo Numbers to\nSend Money for FREE.\nSend Money.\nTo: 01320352256\nAmount: Tk 50\n" +
            "Reference: PT\nEnter Menu PIN to confirm:"
        val receipt = "Send Money Tk 50.00 to 01320352256 successful. Ref PT. Fee Tk 5.00. Balance Tk 17,205.08. TrxID DKH8KOLCEM"
        val steps = walk(SendMoneyFlow(order, pin), menu, "Enter Receiver bKash Account No:",
            "FREE Send Money to 5 Priyo\nNumbers.\nDial *247# and select number 9\nto find priyo Numbers.\nEnter Amount:",
            "FREE Send Money to 5 Priyo\nnumbers up to 25,000 Tk. every\nmonth.\nEnter Reference:", confirm, receipt)
        assertEquals(UssdAction.Reply("1"), steps[0])
        assertEquals(UssdAction.Reply("01320352256"), steps[1])
        assertEquals(UssdAction.Reply("50"), steps[2])
        assertEquals(UssdAction.Reply("0000", secret = true), steps[4])
        val done = steps[5] as UssdAction.Done
        assertEquals("DKH8KOLCEM", done.trx)
        assertEquals(17205.08, done.balance!!, 0.001)
    }
}

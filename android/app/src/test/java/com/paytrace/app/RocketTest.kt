package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Rocket's agent menu, word for word from the owner's two recordings (2026-11-02). */
class RocketTest {
    private val pin = { "0000" }

    private val main = "1.Cash-In\n2.Cash-Out\n3.Registration\n4.Payment\n5.My Acc\n0.LogOut\nSelect Your option"
    private val myAcc = "1.Balance\n2.Statement\n3.Change Pin\n4.Account No\n5.Remittance\n6.Help\n" +
        "7.Activate Account\n9.Main Menu\nSelect your option"
    private val askPin = "Enter Your 4-digit PIN"
    private val balance = "Your A/C balance: Tk 546.59, Available balance: Tk 546.59. Do not share your PIN with others.\n" +
        "1.Main menu\n0.LogOut\nSelect Your option"
    private val receipt = "Cash In to A/C ***924 Success.\nTxnId:7113219742 TxnAmount:\nTk20.00 Your A/C Balance: Tk526.68.\n" +
        "Pls download https://bit.ly/nexuspay.\n1.Main menu\n0.LogOut\nSelect Your option"

    @Test fun theWholeBalanceCheckWalksThrough() {
        var pinReads = 0
        val f = RocketBalanceFlow { pinReads++; "0000" }
        // MIUI words the waiting screen its own way.
        assertEquals(UssdAction.Wait, f.onScreen("Initiated USSD session\nUSSD code running…"))
        assertEquals(UssdAction.Reply("5"), f.onScreen(main))
        assertEquals(UssdAction.Reply("1"), f.onScreen(myAcc))
        assertEquals(UssdAction.Reply("0000", secret = true), f.onScreen(askPin))
        assertEquals(1, pinReads)
        assertEquals(UssdAction.Done(546.59), f.onScreen(balance))
    }

    @Test fun thePinPromptIsRecognisedButTheWordAloneIsNot() {
        // "Enter Your 4-digit PIN": the words between "enter" and "pin" are the wallet's own, digits and all. Before
        // this was fixed the run simply stopped on a screen it should have answered.
        assertTrue(UssdAsk.asksForPin(askPin))
        assertEquals(UssdScreen.ENTER_PIN, RocketUssd.classify(askPin))
        // The balance screen SAYS "PIN" ("Do not share your PIN with others") but asks for nothing.
        assertTrue(!UssdAsk.asksForPin(balance))
        assertEquals(UssdScreen.BALANCE, RocketUssd.classify(balance))
    }

    @Test fun theMenusAreToldApart() {
        assertEquals(UssdScreen.MAIN_MENU, RocketUssd.classify(main))
        assertEquals(UssdScreen.ACCOUNT_MENU, RocketUssd.classify(myAcc))
        assertEquals(UssdScreen.PROGRESS, RocketUssd.classify("Initiated USSD session\nUSSD code running…"))
        // A receipt is never mistaken for a balance answer: it moves money and carries a receipt number.
        assertEquals(UssdScreen.OTHER, RocketUssd.classify(receipt))
        assertTrue(RocketUssd.balanceOnly(receipt) == null)
        assertEquals(546.59, RocketUssd.balanceOnly(balance)!!, 0.001)
    }

    // ---- cash-in ----

    // The owner's real recording was a Tk 20 cash-in. Since 2026-11-04 the floor is Tk 100 (CashInOrder.LEAST), so the
    // order here is 200; the screens are the real ones and the receipt still reads as it did.
    private val order = CashInOrder(UssdProviders.ROCKET, "01846632612", 200.0)

    @Test fun theOwnersRealCashInWalksThrough() {
        val f = CashInFlow(order, pin)
        assertEquals(UssdAction.Reply("1"), f.onScreen(main))
        assertEquals(UssdAction.Reply("01846632612"), f.onScreen("Enter Mobile/Account No"))
        assertEquals(UssdAction.Reply("200"), f.onScreen("Enter Amount"))
        // Rocket's PIN prompt says nothing about the money, which is the exception the owner chose.
        assertEquals(UssdAction.Reply("0000", secret = true), f.onScreen(askPin))
        val done = f.onScreen(receipt) as UssdAction.Done
        // "TxnId:", not "TrxID". Missing it would have read a cash-in that WENT THROUGH as an unknown screen.
        assertEquals("7113219742", done.trx)
        assertEquals(526.68, done.balance!!, 0.001)
    }

    @Test fun theExceptionIsOnlyForABareScreenAndOnlyForRocket() {
        // A screen naming SOME OTHER number or amount is not a bare screen, so the full check still applies and stops it.
        val f = CashInFlow(order, pin)
        f.onScreen(main); f.onScreen("Enter Mobile/Account No"); f.onScreen("Enter Amount")
        assertEquals(
            UssdAction.Fail("confirm_does_not_match"),
            f.onScreen("Cash In\nTo: 01999888777\nAmount: Tk 20.00\nEnter Your 4-digit PIN"),
        )
        assertTrue(!CashInRead.saysNothingAboutTheMoney("To: 01999888777 Enter Your 4-digit PIN"))
        assertTrue(!CashInRead.saysNothingAboutTheMoney("Amount Tk 20.00. Enter PIN"))
        assertTrue(CashInRead.saysNothingAboutTheMoney(askPin))

        // bKash and Nagad keep the strict rule: a bare PIN prompt there stops the run.
        val bkash = CashInFlow(CashInOrder(UssdProviders.BKASH, "01846632612", 3000.0), pin)
        bkash.onScreen("bKash\n1 Cash In\n2 B2B Transfer\n3 Pay Bill\n4 My bKash\n5 Helpline")
        bkash.onScreen("Enter Customer bKash Account No:")
        bkash.onScreen("Enter Amount:")
        assertEquals(UssdAction.Fail("confirm_does_not_match"), bkash.onScreen(askPin))
    }

    @Test fun eachWalletKnowsItsOwnWayIn() {
        assertEquals("*322#", UssdProviders.dialCode(UssdProviders.ROCKET))
        assertEquals("Rocket", UssdProviders.label(UssdProviders.ROCKET))
        assertTrue(UssdProviders.isKnown(UssdProviders.ROCKET))
        assertTrue(!UssdProviders.oneCode(UssdProviders.ROCKET))
        assertEquals("5", UssdProviders.ownMenuPick(UssdProviders.ROCKET))
        assertEquals("4", UssdProviders.ownMenuPick(UssdProviders.BKASH))
        assertEquals("6", UssdProviders.ownMenuPick(UssdProviders.NAGAD))
        assertTrue(UssdProviders.confirmsCashIn(UssdProviders.BKASH))
        assertTrue(UssdProviders.confirmsCashIn(UssdProviders.NAGAD))
        assertTrue(!UssdProviders.confirmsCashIn(UssdProviders.ROCKET))
    }

    @Test fun theStatementWalksRocketsOwnNumbers() {
        val f = StatementFlow(UssdProviders.ROCKET, null, pin)
        assertEquals(UssdAction.Reply("5"), f.onScreen(main))
        assertEquals(UssdAction.Reply("2"), f.onScreen(myAcc))
        assertEquals(UssdAction.Reply("0000", secret = true), f.onScreen(askPin))
    }
}

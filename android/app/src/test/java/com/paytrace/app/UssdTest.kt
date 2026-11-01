package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The screens below are the real Nagad *167# dialogs from the owner's recordings (numbers and PIN replaced). */
class UssdTest {
    private val mainMenu = "Nagad\n1. Cash In\n2. Register Customer\n3. B2B\n4. Bill Pay\n5. EMI Payment\n6. My Nagad"
    private val myNagad = "My Nagad\n1. Balance Enquiry\n2. Mini Statement\n3. Change PIN\n4. Update Operator\n5. Helpline\n6. Allow New Device\n0. Main Menu"
    private val pinScreen = "Enter PIN:"
    private val balanceScreen = "Balance: Tk 17200.42\n0. Main Menu"
    private val cashInConfirm = "Cash In\nTo: 01700000000\nAmount: Tk 100.00\nEnter PIN:"
    private val cashInDone = "Cash In Tk 100.00 to 01700000000 is successful.\nTrxID: 768QVSLN\nBalance: Tk 17200.42\n0. Main Menu"

    @Test fun recognisesEveryScreenOfTheBalanceCheck() {
        assertEquals(UssdScreen.MAIN_MENU, NagadUssd.classify(mainMenu))
        assertEquals(UssdScreen.MY_NAGAD_MENU, NagadUssd.classify(myNagad))
        assertEquals(UssdScreen.ENTER_PIN, NagadUssd.classify(pinScreen))
        assertEquals(UssdScreen.BALANCE, NagadUssd.classify(balanceScreen))
        assertEquals(UssdScreen.PROGRESS, NagadUssd.classify("USSD code running..."))
    }

    @Test fun aCashInScreenIsNeverTakenForABalanceCheckScreen() {
        // The cash-in PIN prompt lists an amount and an account: it must not look like the plain PIN prompt.
        assertEquals(UssdScreen.OTHER, NagadUssd.classify(cashInConfirm))
        // The cash-in result also prints a balance, but it is not the balance screen.
        assertEquals(UssdScreen.OTHER, NagadUssd.classify(cashInDone))
    }

    @Test fun readsTheBalance() {
        assertEquals(17200.42, NagadUssd.balanceOf(balanceScreen)!!, 0.001)
        assertEquals(1234567.5, NagadUssd.balanceOf("Balance: Tk 1,234,567.50")!!, 0.001)
        assertEquals(16.18, NagadUssd.balanceOf("Your A/C Balance: Tk16.18.")!!, 0.001)
        assertNull(NagadUssd.balanceOf("Enter PIN:"))
    }

    @Test fun walksTheWholeCheckAndTypesThePinOnce() {
        var pinReads = 0
        val flow = NagadBalanceFlow { pinReads++; "0000" }
        assertEquals(UssdAction.Wait, flow.onScreen("USSD code running..."))
        assertEquals(UssdAction.Reply("6"), flow.onScreen(mainMenu))
        // The same dialog reported twice by the phone: nothing more is sent.
        assertEquals(UssdAction.Wait, flow.onScreen(mainMenu))
        assertEquals(UssdAction.Reply("1"), flow.onScreen(myNagad))
        val pin = flow.onScreen(pinScreen)
        assertEquals(UssdAction.Reply("0000", secret = true), pin)
        assertEquals(1, pinReads)
        val done = flow.onScreen(balanceScreen)
        assertTrue(done is UssdAction.Done)
        assertEquals(17200.42, (done as UssdAction.Done).balance, 0.001)
        assertEquals(1, pinReads)
    }

    @Test fun neverTypesThePinOnAMoneyScreen() {
        var pinReads = 0
        val flow = NagadBalanceFlow { pinReads++; "0000" }
        flow.onScreen(mainMenu)
        flow.onScreen(myNagad)
        // The phone unexpectedly shows a cash-in confirmation where the plain PIN prompt should be.
        assertEquals(UssdAction.Fail("unexpected_screen"), flow.onScreen(cashInConfirm))
        assertEquals(0, pinReads)
    }

    @Test fun aWrongPinIsNotRetried() {
        var pinReads = 0
        val flow = NagadBalanceFlow { pinReads++; "0000" }
        flow.onScreen(mainMenu)
        flow.onScreen(myNagad)
        flow.onScreen(pinScreen)
        // Any answer that is not the balance stops the run, and the PIN is not asked for again.
        assertEquals(UssdAction.Fail("unexpected_screen"), flow.onScreen("Invalid PIN. You have 2 attempts left."))
        assertEquals(1, pinReads)
    }

    @Test fun aSecondPinPromptIsNeverAnswered() {
        var pinReads = 0
        val flow = NagadBalanceFlow { pinReads++; "0000" }
        flow.onScreen(mainMenu)
        flow.onScreen(myNagad)
        flow.onScreen(pinScreen)
        // The exact same prompt again: treated as the same dialog, nothing is typed.
        assertEquals(UssdAction.Wait, flow.onScreen(pinScreen))
        // A prompt with a warning in front looks like a PIN prompt but arrives after the PIN was sent: stop.
        assertEquals(UssdAction.Fail("unexpected_screen"), flow.onScreen("Wrong PIN, try again.\nEnter PIN:"))
        assertEquals(1, pinReads)
    }

    @Test fun stopsIfTheScreensAreOutOfOrder() {
        assertEquals(UssdAction.Fail("unexpected_screen"), NagadBalanceFlow { "0000" }.onScreen(pinScreen))
        assertEquals(UssdAction.Fail("unexpected_screen"), NagadBalanceFlow { "0000" }.onScreen(myNagad))
        assertEquals(UssdAction.Fail("unexpected_screen"), NagadBalanceFlow { "0000" }.onScreen("Connection problem or invalid MMI code."))
    }

    @Test fun noSavedPinMeansNoTyping() {
        val flow = NagadBalanceFlow { "" }
        flow.onScreen(mainMenu)
        flow.onScreen(myNagad)
        assertEquals(UssdAction.Fail("no_pin"), flow.onScreen(pinScreen))
    }

    @Test fun blankScreensAreIgnored() {
        assertEquals(UssdAction.Wait, NagadBalanceFlow { "0000" }.onScreen("   "))
    }

    @Test fun findsTheDialersCallButtonByItsLabel() {
        assertTrue(UssdLabels.isCallButton("Dial"))
        assertTrue(UssdLabels.isCallButton(" call "))
        assertTrue(UssdLabels.isCallButton("Make a call"))
        // Other buttons on the dialer or in the call log must not be pressed.
        assertTrue(!UssdLabels.isCallButton("Call history"))
        assertTrue(!UssdLabels.isCallButton("Delete"))
        assertTrue(!UssdLabels.isCallButton("Voicemail"))
        assertTrue(!UssdLabels.isCallButton(null))
        assertTrue(!UssdLabels.isCallButton(""))
    }

    @Test fun findsTheCallButtonByTextOrByViewIdToo() {
        assertTrue(UssdLabels.isCallButton("কল"))
        assertTrue(UssdLabels.isCallButtonId("com.google.android.dialer:id/dialpad_floating_action_button"))
        assertTrue(UssdLabels.isCallButtonId("com.android.contacts:id/dial_button"))
        assertTrue(UssdLabels.isCallButtonId("com.samsung.android.dialer:id/call_button"))
        assertTrue(!UssdLabels.isCallButtonId("com.google.android.dialer:id/dialpad_key_one"))
        assertTrue(!UssdLabels.isCallButtonId("com.google.android.dialer:id/call_history_tab"))
        assertTrue(!UssdLabels.isCallButtonId(null))
        assertTrue(!UssdLabels.isCallButtonId(""))
    }

    @Test fun aFailedRunIsTriedOnceMoreOnlyBeforeThePin() {
        // Before the PIN was submitted a timing failure may be tried again, once.
        assertTrue(UssdRetry.shouldRetry("timeout", ok = false, pinSent = false, attempt = 1))
        assertTrue(UssdRetry.shouldRetry("no_send_button", ok = false, pinSent = false, attempt = 1))
        assertTrue(UssdRetry.shouldRetry("sim_not_found", ok = false, pinSent = false, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry("timeout", ok = false, pinSent = false, attempt = 2))
        // After the PIN went in: never, whatever the error.
        assertTrue(!UssdRetry.shouldRetry("timeout", ok = false, pinSent = true, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry("unexpected_screen", ok = false, pinSent = true, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry("no_answer_after_pin", ok = false, pinSent = false, attempt = 1))
        // A missing setup cannot be fixed by trying again; a success is not retried.
        assertTrue(!UssdRetry.shouldRetry("no_pin", ok = false, pinSent = false, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry("not_allowed", ok = false, pinSent = false, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry("no_accessibility", ok = false, pinSent = false, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry(null, ok = true, pinSent = false, attempt = 1))
        assertTrue(!UssdRetry.shouldRetry(null, ok = false, pinSent = false, attempt = 1))
    }
}

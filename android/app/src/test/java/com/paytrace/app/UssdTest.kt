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
        assertEquals(UssdAction.Fail("wallet_refused"), flow.onScreen("Invalid PIN. You have 2 attempts left."))
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
        assertEquals(UssdAction.Fail("wallet_refused"), flow.onScreen("Wrong PIN, try again.\nEnter PIN:"))
        assertEquals(1, pinReads)
    }

    @Test fun stopsIfTheScreensAreOutOfOrder() {
        assertEquals(UssdAction.Fail("unexpected_screen"), NagadBalanceFlow { "0000" }.onScreen(pinScreen))
        assertEquals(UssdAction.Fail("unexpected_screen"), NagadBalanceFlow { "0000" }.onScreen(myNagad))
        // The phone failing to send the code is not the wallet refusing, so it keeps its own reason.
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

    @Test fun buildsTheOneLineBalanceCodeOnlyFromADigitPin() {
        assertEquals("*167*6*1*1234#", NagadUssd.balanceCode("1234"))
        assertEquals("*167*6*1*12345678#", NagadUssd.balanceCode("12345678"))
        // Anything that is not 4 to 8 digits is refused, so no "*" or "#" can be slipped into a code the phone sends.
        assertNull(NagadUssd.balanceCode(""))
        assertNull(NagadUssd.balanceCode("123"))
        assertNull(NagadUssd.balanceCode("123456789"))
        assertNull(NagadUssd.balanceCode("12#4"))
        assertNull(NagadUssd.balanceCode("1234*"))
        assertNull(NagadUssd.balanceCode("12 34"))
        assertNull(NagadUssd.balanceCode("12a4"))
    }

    @Test fun readsTheNetworksAnswerToTheOneLineCode() {
        assertEquals(UssdAction.Done(17200.42), UssdDirect.readReply("Balance: Tk 17200.42\n0. Main Menu"))
        assertEquals(UssdAction.Done(1234567.5), UssdDirect.readReply("  Your Balance: Tk 1,234,567.50  "))
        // A menu, an error or a cash-in receipt is never taken for a balance.
        assertEquals(UssdAction.Fail("unexpected_screen"), UssdDirect.readReply("Enter PIN:"))
        assertEquals(UssdAction.Fail("unexpected_screen"), UssdDirect.readReply("Service is not available at the moment"))
        assertEquals(UssdAction.Fail("unexpected_screen"), UssdDirect.readReply(cashInDone))
        assertEquals(UssdAction.Fail("unexpected_screen"), UssdDirect.readReply(""))
    }

    @Test fun onlyAnUnavailableServiceMeansNothingWasSent() {
        // -2 = the phone could not start the request, so the dialer way may still be tried. Any other failure may have carried the PIN.
        assertTrue(UssdDirect.nothingWasSent(-2))
        assertTrue(!UssdDirect.nothingWasSent(-1))
        assertTrue(!UssdDirect.nothingWasSent(0))
        assertEquals("dial_failed", UssdDirect.failureError(-2))
        assertEquals("ussd_failed", UssdDirect.failureError(-1))
    }

    @Test fun twoChecksTooCloseTogetherAreRefused() {
        assertTrue(!UssdDirect.tooSoon(0L, 100_000L))
        assertTrue(UssdDirect.tooSoon(100_000L, 100_000L + 44_999L))
        assertTrue(!UssdDirect.tooSoon(100_000L, 100_000L + 45_000L))
        // A clock that went backwards must not block for ever.
        assertTrue(!UssdDirect.tooSoon(100_000L, 50_000L))
    }

    // ---- bKash (agent menu), the real screens of the owner's recording 2026-11-01 ----
    private val bkMain = "bKash\n1 Cash In\n2 B2B Transfer\n3 Pay Bill\n4 My bKash\n5 Helpline"
    private val bkAccount = "bKash\n1 Check Balance\n2 Request Statement\n3 Change Mobile Menu PIN\n4 Update MNP Info\n0 Main Menu"
    private val bkBalance = "bKash\nCurrent balance Tk 1,570.78. Available balance Tk 1,570.78.\n0. Main Menu"

    @Test fun recognisesEveryScreenOfTheBkashBalanceCheck() {
        assertEquals(UssdScreen.MAIN_MENU, BkashUssd.classify(bkMain))
        assertEquals(UssdScreen.ACCOUNT_MENU, BkashUssd.classify(bkAccount))
        assertEquals(UssdScreen.ENTER_PIN, BkashUssd.classify("Enter PIN:"))
        assertEquals(UssdScreen.BALANCE, BkashUssd.classify(bkBalance))
        assertEquals(UssdScreen.PROGRESS, BkashUssd.classify("USSD code running..."))
        assertEquals(UssdScreen.OTHER, BkashUssd.classify("Service not available please try again later"))
        // A PIN prompt that also names an amount or a number is a money screen, never the plain PIN prompt.
        assertEquals(UssdScreen.OTHER, BkashUssd.classify("Send Money\nTo: 01700000000\nAmount: Tk 100\nEnter PIN:"))
    }

    @Test fun readsTheBkashBalance() {
        assertEquals(1570.78, BkashUssd.balanceOf(bkBalance)!!, 0.001)
        assertEquals(12.5, BkashUssd.balanceOf("Current balance Tk 12.50")!!, 0.001)
        assertNull(BkashUssd.balanceOf("Enter PIN:"))
    }

    @Test fun walksTheWholeBkashCheckAndGivesThePinOnce() {
        var pinReads = 0
        val flow = BkashBalanceFlow { pinReads++; "0000" }
        assertEquals(UssdAction.Wait, flow.onScreen("USSD code running..."))
        assertEquals(UssdAction.Reply("4"), flow.onScreen(bkMain))
        assertEquals(UssdAction.Wait, flow.onScreen(bkMain))
        assertEquals(UssdAction.Reply("1"), flow.onScreen(bkAccount))
        assertEquals(UssdAction.Reply("0000", secret = true), flow.onScreen("Enter PIN:"))
        assertEquals(1, pinReads)
        assertEquals(UssdAction.Done(1570.78), flow.onScreen(bkBalance))
        assertEquals(1, pinReads)
    }

    @Test fun theBkashFlowNeverGivesThePinOutOfOrderOrTwice() {
        // The PIN prompt straight away (no menus first) is not what is expected.
        assertEquals(UssdAction.Fail("unexpected_screen"), BkashBalanceFlow { "0000" }.onScreen("Enter PIN:"))
        // A refusal where a menu should be stops the run, and says so in its own words.
        assertEquals(UssdAction.Fail("wallet_refused"), BkashBalanceFlow { "0000" }.onScreen("Service is not available at the moment"))
        // A second PIN prompt after the PIN went in is not answered.
        var pinReads = 0
        val flow = BkashBalanceFlow { pinReads++; "0000" }
        flow.onScreen(bkMain)
        flow.onScreen(bkAccount)
        flow.onScreen("Enter PIN:")
        assertEquals(UssdAction.Fail("wallet_refused"), flow.onScreen("Wrong PIN, try again.\nEnter PIN:"))
        assertEquals(1, pinReads)
        // No saved PIN means nothing is typed.
        val noPin = BkashBalanceFlow { "" }
        noPin.onScreen(bkMain)
        noPin.onScreen(bkAccount)
        assertEquals(UssdAction.Fail("no_pin"), noPin.onScreen("Enter PIN:"))
    }

    @Test fun aPinPromptIsRecognisedHoweverTheWalletWordsIt() {
        // bKash does not word it the same way everywhere: the balance check says "Enter PIN:", Request Statement says
        // "Enter Menu PIN:" (owner's phone, 2026-11-02). Both are the same question and both must be answered.
        assertEquals(UssdScreen.ENTER_PIN, BkashUssd.classify("Enter PIN:"))
        assertEquals(UssdScreen.ENTER_PIN, BkashUssd.classify("Enter Menu PIN:"))
        assertEquals(UssdScreen.ENTER_PIN, NagadUssd.classify("Enter Menu PIN:"))
        // What keeps this safe is the rule around it, not the wording: a screen that moves money is never a plain PIN
        // prompt, whatever it calls the PIN.
        assertEquals(UssdScreen.OTHER, BkashUssd.classify("Cash In.\nTo: 01846632612\nAmount: Tk 200\nEnter Menu PIN to confirm:"))
        assertTrue(!UssdAsk.asksForPin("You entered a wrong PIN"))
        var pinReads = 0
        val flow = BkashBalanceFlow { pinReads++; "0000" }
        flow.onScreen(bkMain)
        flow.onScreen(bkAccount)
        assertEquals(UssdAction.Reply("0000", secret = true), flow.onScreen("Enter Menu PIN:"))
        assertEquals(1, pinReads)
    }

    @Test fun theContinueQuestionBeforeTheMenuIsAnsweredNo() {
        // Real screen, owner's bKash agent menu 2026-11-02: it comes up when an earlier session was left open, and
        // answering "2 - No" opened a fresh main menu. "1 - Yes" would carry on that other, unknown session.
        val ask = "Do you want to continue?\n1 - Yes\n2 - No"
        assertEquals(UssdScreen.CONTINUE_ASK, BkashUssd.classify(ask))
        assertEquals(UssdScreen.CONTINUE_ASK, NagadUssd.classify(ask))
        var pinReads = 0
        val flow = BkashBalanceFlow { pinReads++; "0000" }
        assertEquals(UssdAction.Reply("2"), flow.onScreen(ask))
        assertEquals(UssdAction.Reply("4"), flow.onScreen(bkMain))
        assertEquals(UssdAction.Reply("1"), flow.onScreen(bkAccount))
        assertEquals(UssdAction.Reply("0000", secret = true), flow.onScreen("Enter PIN:"))
        assertEquals(1, pinReads)
        // Asked a second time it is not answered again, so it can never become a loop.
        val twice = NagadBalanceFlow { "0000" }
        assertEquals(UssdAction.Reply("2"), twice.onScreen(ask))
        assertEquals(UssdAction.Fail("unexpected_screen"), twice.onScreen(ask + "\n(choose one)"))
    }

    @Test fun eachWalletHasItsOwnCodeAndFlow() {
        assertEquals("*167#", UssdProviders.dialCode(UssdProviders.NAGAD))
        assertEquals("*247#", UssdProviders.dialCode(UssdProviders.BKASH))
        assertEquals("Nagad", UssdProviders.label("nagad"))
        assertEquals("bKash", UssdProviders.label("bkash"))
        assertTrue(UssdProviders.isKnown("nagad") && UssdProviders.isKnown("bkash") && !UssdProviders.isKnown("rocket") && !UssdProviders.isKnown(""))
        // Nagad takes the whole check as one code; bKash has to be walked.
        assertTrue(UssdProviders.oneCode("nagad") && !UssdProviders.oneCode("bkash"))
        assertTrue(UssdProviders.flow("nagad") { "0000" }.recognises(mainMenu))
        assertTrue(!UssdProviders.flow("nagad") { "0000" }.recognises(bkMain))
        assertTrue(UssdProviders.flow("bkash") { "0000" }.recognises(bkMain))
        assertTrue(!UssdProviders.flow("bkash") { "0000" }.recognises(mainMenu))
    }

    @Test fun aScreenCanBeDescribedWithoutShowingAnyNumber() {
        // What a failed run writes into its log: the words, but never a PIN, a wallet number or a balance.
        assertEquals("Enter PIN:", UssdRedact.snippet("Enter PIN:"))
        assertEquals("Balance: Tk ***", UssdRedact.snippet("Balance: Tk 17200.42"))
        assertEquals("Cash In to ***", UssdRedact.snippet("Cash In to 01706630756"))
        assertEquals("(nothing readable)", UssdRedact.snippet(""))
        assertEquals("(nothing readable)", UssdRedact.snippet(null))
        // Several lines become one, and a long screen is cut short.
        assertEquals("a b c", UssdRedact.snippet("a\n  b \t c "))
        assertEquals("abcde...", UssdRedact.snippet("abcdefghij", 5))
        // A single digit is a menu number, not a secret, so it stays readable.
        assertEquals("1. Cash In 2. B2B", UssdRedact.snippet("1. Cash In 2. B2B"))
    }

    @Test fun theDialogsOwnButtonsAreFoundByTheirViewId() {
        // For phones whose Send button carries a word in another language.
        assertTrue(UssdLabels.isPositiveId("android:id/button1"))
        assertTrue(UssdLabels.isPositiveId("com.android.phone:id/send"))
        assertTrue(UssdLabels.isNegativeId("android:id/button2"))
        assertTrue(!UssdLabels.isPositiveId("android:id/button2"))
        assertTrue(!UssdLabels.isPositiveId("com.android.phone:id/message"))
        assertTrue(!UssdLabels.isPositiveId(null) && !UssdLabels.isNegativeId(null))
    }

    @Test fun aPhoneThatCannotSendTheCodeMovesItselfToTheDialerWay() {
        val failed = "0.0s direct USSD request, SIM 1\n0.0s request handed to the phone\n1.0s phone reported failure code -1"
        val refused = "0.0s direct USSD request, SIM 1\n0.8s answer was not a balance: Please try later. Thank you!"
        val silent = "0.0s direct USSD request, SIM 1\n45.0s network never answered"
        val walked = "0.0s direct menu walk, SIM 1\n2.8s direct way could not go on: failure code -1"
        val worked = "0.0s direct USSD request, SIM 1\n0.0s request handed to the phone\n2.0s balance read"
        val dialerOnly = "0.0s start, dialer way, bKash, try 1\n1.0s Call pressed\n8.0s no answer, saying it again"
        assertTrue(UssdDirectHealth.directFailed(failed))
        assertTrue(UssdDirectHealth.directFailed(refused))
        assertTrue(UssdDirectHealth.directFailed(silent))
        assertTrue(UssdDirectHealth.directFailed(walked))
        assertTrue(!UssdDirectHealth.directFailed(worked))
        // A run that never used the direct way says nothing about it, whatever went wrong in the dialer.
        assertTrue(!UssdDirectHealth.directFailed(dialerOnly))

        // Two failures in a row are enough; one is not, and a run that works starts the count again.
        // "failure code -1" is the one that can never work here, so it counts straight to the end (see the log test).
        assertEquals(UssdDirectHealth.ENOUGH, UssdDirectHealth.count(0, failed))
        assertEquals(2, UssdDirectHealth.count(1, refused))
        assertEquals(0, UssdDirectHealth.count(1, worked))
        assertEquals(0, UssdDirectHealth.count(1, dialerOnly))
        assertTrue(!UssdDirectHealth.shouldSwitch(1, true))
        assertTrue(UssdDirectHealth.shouldSwitch(2, true))
        // Never switch to a way that cannot work: the dialer way needs Accessibility.
        assertTrue(!UssdDirectHealth.shouldSwitch(2, false))
    }

    @Test fun oneFailureCodeMinusOneIsEnoughToMoveAPhoneToTheDialerWay() {
        // From the owner's Redmi log (2026-11-02): the network answered "Balance: Tk 818.35 / 0. Main Menu", but because
        // that answer keeps the menu open Android gave the app only "failure code -1". It will do so every time, so the
        // phone does not wait for a second try before moving to the dialer way.
        val minusOne = "0.0s direct USSD request, SIM 1\n0.0s request handed to the phone\n1.0s phone reported failure code -1"
        assertTrue(UssdDirectHealth.cannotWorkHere(minusOne))
        assertEquals(UssdDirectHealth.ENOUGH, UssdDirectHealth.count(0, minusOne))
        assertTrue(UssdDirectHealth.shouldSwitch(UssdDirectHealth.count(0, minusOne), true))
        // Another kind of failure still needs two in a row, and a run that worked clears the count.
        val refused = "0.0s direct USSD request, SIM 1\n0.8s answer was not a balance: Please try later."
        assertTrue(!UssdDirectHealth.cannotWorkHere(refused))
        assertEquals(1, UssdDirectHealth.count(0, refused))
        assertEquals(0, UssdDirectHealth.count(1, "0.0s direct USSD request, SIM 1\n2.0s balance read"))
    }

    @Test fun theSimQuestionIsRecognisedHoweverThePhoneWordsIt() {
        // The owner's Vivo, word for word.
        assertTrue(UssdLabels.asksWhichSim("Choose SIM for this call\nSIM1 +880 1706-630756\nSIM2 +880 1345-567224"))
        // MIUI and other brands.
        assertTrue(UssdLabels.asksWhichSim("Select SIM card"))
        assertTrue(UssdLabels.asksWhichSim("SIM card"))
        assertTrue(UssdLabels.asksWhichSim("Call with"))
        // No words PayTrace knows, but both SIMs are named: still the question.
        assertTrue(UssdLabels.asksWhichSim("Grameenphone SIM 1\nRobi SIM 2"))
        // Not the question.
        assertTrue(!UssdLabels.asksWhichSim("Enter PIN:"))
        assertTrue(!UssdLabels.asksWhichSim("1. Cash In 2. Register Customer"))
        assertTrue(!UssdLabels.asksWhichSim(null))
    }

    @Test fun aRowThatNamesASimIsFoundWhateverElseIsOnIt() {
        assertTrue(UssdLabels.namesSim("SIM1 +880 1706-630756", 0))
        assertTrue(UssdLabels.namesSim("SIM 2  Robi", 1))
        assertTrue(!UssdLabels.namesSim("SIM 2  Robi", 0))
        assertTrue(!UssdLabels.namesSim("Grameenphone", 0))
        assertTrue(!UssdLabels.namesSim(null, 0))
    }

    @Test fun aButtonIsNeverTakenForAChoice() {
        // So picking a SIM by its position can never land on Cancel.
        assertTrue(UssdLabels.isChoice("Grameenphone"))
        assertTrue(UssdLabels.isChoice("SIM 1"))
        assertTrue(!UssdLabels.isChoice("Cancel"))
        assertTrue(!UssdLabels.isChoice("CANCEL"))
        assertTrue(!UssdLabels.isChoice("OK"))
        assertTrue(!UssdLabels.isChoice(" "))
        assertTrue(!UssdLabels.isChoice(null))
    }

    @Test fun aGreySimIsNeverTappedAndTheRunSaysWhy() {
        // The owner's Redmi: both phones show the Google dialer's "Choose SIM for this call", but one SIM is in the phone
        // without a network, so the phone draws it grey. Tapping it does nothing, and the run used to run out of time.
        val grey2 = listOf(SimRow("SIM1 +880 1706-630756", true), SimRow("SIM2", false))
        assertEquals(UssdSimPick.Pick.Tap(0), UssdSimPick.choose(grey2, 0))
        assertEquals(UssdSimPick.Pick.Stop("sim_no_service"), UssdSimPick.choose(grey2, 1))

        // Both working: the row that names the wanted SIM wins, wherever it sits.
        val both = listOf(SimRow("SIM 2  Robi", true), SimRow("SIM 1  Grameenphone", true))
        assertEquals(UssdSimPick.Pick.Tap(1), UssdSimPick.choose(both, 0))
        assertEquals(UssdSimPick.Pick.Tap(0), UssdSimPick.choose(both, 1))

        // No row names a SIM (some phones show only the networks): first row is SIM 1, second is SIM 2.
        val networks = listOf(SimRow("Grameenphone", true), SimRow("Robi", false))
        assertEquals(UssdSimPick.Pick.Tap(0), UssdSimPick.choose(networks, 0))
        assertEquals(UssdSimPick.Pick.Stop("sim_no_service"), UssdSimPick.choose(networks, 1))

        // Anything else is left alone rather than guessed at.
        assertEquals(UssdSimPick.Pick.Wait, UssdSimPick.choose(listOf(SimRow("Grameenphone", true)), 0))
        assertEquals(UssdSimPick.Pick.Wait, UssdSimPick.choose(emptyList(), 0))
        assertEquals(UssdSimPick.Pick.Wait, UssdSimPick.choose(listOf(SimRow("a", true), SimRow("b", true), SimRow("c", true)), 1))
    }

    @Test fun theOwnersTwoRealSimChoosersBothWork() {
        // Photographed side by side, 2026-11-02. Same dialog title on both phones, different rows.
        // The Vivo names the SIMs.
        val vivo = listOf(SimRow("1 SIM1 +880 1706-630756", true), SimRow("2 SIM2 +880 1345-567224", true))
        assertEquals(UssdSimPick.Pick.Tap(0), UssdSimPick.choose(vivo, 0))
        assertEquals(UssdSimPick.Pick.Tap(1), UssdSimPick.choose(vivo, 1))

        // The Redmi names the network on both rows, and the SIM with no network says so in words.
        val redmi = listOf(
            SimRow("1 Grameenphone +880 1721-627183 No signal", true),
            SimRow("2 Grameenphone +880 1732-533847", true),
        )
        // Nagad is on SIM 2 there, which is the row PayTrace must tap.
        assertEquals(UssdSimPick.Pick.Tap(1), UssdSimPick.choose(redmi, 1))
        // Choosing the other one is refused rather than tapped: "No signal" means no call can go out on it.
        assertEquals(UssdSimPick.Pick.Stop("sim_no_service"), UssdSimPick.choose(redmi, 0))
        assertTrue(!UssdSimPick.usable(redmi[0]))
        assertTrue(UssdSimPick.usable(redmi[1]))
    }

    @Test fun aCodeThatWentOutAsACallIsNoticedAtOnce() {
        // The owner's video: the dialer holds "*247#", then the phone shows a call screen with "*247*" on it.
        assertTrue(UssdLabels.looksLikeACall("Calling via SIM1\n*247*\n*247*"))
        assertTrue(UssdLabels.looksLikeACall("*167*\nKeypad Mute Speaker More"))
        // A real menu, a dialer keypad and an ordinary call are not that.
        assertTrue(!UssdLabels.looksLikeACall("Calling via SIM1\n+880 1706-630756"))
        assertTrue(!UssdLabels.looksLikeACall("1. Cash In 2. B2B Transfer"))
        assertTrue(!UssdLabels.looksLikeACall("*247#"))
        assertTrue(!UssdLabels.looksLikeACall(null))
    }

    @Test fun onlyTheKeypadsOwnCallButtonIsTrusted() {
        // The dialer lists recent calls above the keypad, each with its own call icon. Pressing one of those redials that
        // old number: the owner's video shows "*247#" in the box going out as a call to "*247*".
        assertTrue(UssdLabels.isDialpadCallId("com.google.android.dialer:id/dialpad_floating_action_button"))
        assertTrue(UssdLabels.isDialpadCallId("com.android.dialer:id/dialpad_fab"))
        assertTrue(!UssdLabels.isDialpadCallId("com.google.android.dialer:id/call_button"))
        assertTrue(!UssdLabels.isDialpadCallId("com.google.android.dialer:id/primary_action_button"))
        assertTrue(!UssdLabels.isDialpadCallId(null))
        // The wider list still recognises those as call-ish, which is why the keypad one has to be preferred.
        assertTrue(UssdLabels.isCallButtonId("com.google.android.dialer:id/call_button"))
    }

    @Test fun aCallPayTraceDidNotMeanToMakeCanBeEnded() {
        assertTrue(UssdLabels.isEndCall("End call", null))
        assertTrue(UssdLabels.isEndCall("end", null))
        assertTrue(UssdLabels.isEndCall(null, "com.android.incallui:id/incall_end_call"))
        assertTrue(!UssdLabels.isEndCall("Call", "com.google.android.dialer:id/dialpad_fab"))
        assertTrue(!UssdLabels.isEndCall(null, null))
    }
}

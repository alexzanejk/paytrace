package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The statement walk, built from the owner's real bKash agent menu (2026-11-02). It only reads, so the tests are
 *  about getting the right screens back and never wandering off the path. */
class StatementTest {
    private val pin = { "0000" }

    private val menu = "bKash\n1 Cash In\n2 B2B Transfer\n3 Pay Bill\n4 My bKash\n5 Helpline"
    private val myBkash = "bKash\n1 Check Balance\n2 Request Statement\n3 Change Mobile Menu PIN\n4 Update MNP Info\n0 Main Menu"
    private val askPin = "Enter Menu PIN:"
    private val page1 = "Statement List:\n1 02/11/26 Cash In -Tk -200.00\n2 29/10/26 Cash Out -Tk 500.00\n" +
        "3 28/10/26 Cash Out -Tk 500.00\n4 28/10/26 Cash Out -Tk 500.00\n# NEXT"
    private val page2 = "5 28/10/26 B2B Transfer -Tk -5000.00\n6 27/10/26 B2B Transfer -Tk 5000.00\n00 BACK"
    private val detail = "Cash In Tk -200.00\nFee Tk 0.00\nFrom 01706630756\nTo 01846632612\n" +
        "TrxID DK29URXBHB\nAt 02/11/2026 06:24:45"

    @Test fun theListIsCollectedPageByPage() {
        val f = StatementFlow(UssdProviders.BKASH, null, pin)
        assertEquals(UssdAction.Reply("4"), f.onScreen(menu))
        assertEquals(UssdAction.Reply("2"), f.onScreen(myBkash))
        assertEquals(UssdAction.Reply("0000", secret = true), f.onScreen(askPin))
        // The first page offers another, so the wallet is asked for it.
        assertEquals(UssdAction.Reply("#"), f.onScreen(page1))
        // The last page does not, so that is the end.
        val done = f.onScreen(page2) as UssdAction.Done
        assertEquals(listOf(page1, page2), done.screens)
        // A statement is not about a balance, and must not be reported as one.
        assertTrue(done.balance == null)
        assertTrue(done.trx == null)
    }

    @Test fun oneEntryIsOpenedByItsOwnNumber() {
        val f = StatementFlow(UssdProviders.BKASH, 1, pin)
        f.onScreen(menu); f.onScreen(myBkash); f.onScreen(askPin)
        assertEquals(UssdAction.Reply("1"), f.onScreen(page1))
        val done = f.onScreen(detail) as UssdAction.Done
        assertEquals(listOf(page1, detail), done.screens)
    }

    @Test fun anEntryOnALaterPageIsPagedTo() {
        val f = StatementFlow(UssdProviders.BKASH, 5, pin)
        f.onScreen(menu); f.onScreen(myBkash); f.onScreen(askPin)
        // Entry 5 is not on the first page, so the wallet is asked for the next one.
        assertEquals(UssdAction.Reply("#"), f.onScreen(page1))
        assertEquals(UssdAction.Reply("5"), f.onScreen(page2))
        assertTrue(f.onScreen(detail) is UssdAction.Done)
    }

    @Test fun anEntryTheWalletDoesNotListStopsTheRun() {
        val f = StatementFlow(UssdProviders.BKASH, 9, pin)
        f.onScreen(menu); f.onScreen(myBkash); f.onScreen(askPin)
        f.onScreen(page1)
        // The last page has no entry 9 and offers nothing further.
        assertEquals(UssdAction.Fail("entry_not_found"), f.onScreen(page2))
    }

    @Test fun itNeverWandersOffThePath() {
        // The PIN is never typed before the two menus have been walked.
        assertEquals(UssdAction.Fail("unexpected_screen"), StatementFlow(UssdProviders.BKASH, null, pin).onScreen(askPin))
        var pinReads = 0
        val f = StatementFlow(UssdProviders.BKASH, null) { pinReads++; "0000" }
        f.onScreen(menu)
        // A cash-in confirmation where the wallet's own menu should be: stop, PIN untouched.
        assertEquals(
            UssdAction.Fail("unexpected_screen"),
            f.onScreen("Cash In.\nTo: 01846632612\nAmount: Tk 200\nEnter Menu PIN to confirm:"),
        )
        assertEquals(0, pinReads)
        // The wallet saying no stops it with its own reason.
        val g = StatementFlow(UssdProviders.BKASH, null, pin)
        g.onScreen(menu); g.onScreen(myBkash); g.onScreen(askPin)
        assertEquals(UssdAction.Fail("wallet_refused"), g.onScreen("Service is not available at the moment"))
    }

    @Test fun theContinueQuestionIsAnsweredNoBeforeTheMenu() {
        val f = StatementFlow(UssdProviders.BKASH, null, pin)
        assertEquals(UssdAction.Reply("2"), f.onScreen("Do you want to continue?\n1 - Yes\n2 - No"))
        assertEquals(UssdAction.Reply("4"), f.onScreen(menu))
    }

    @Test fun nagadWalksItsOwnMenuNumbers() {
        // Nagad's statement screens have never been seen; what is certain is the way in, which is the same shape.
        val nagadMain = "Nagad\n1. Cash In\n2. Register Customer\n3. B2B\n4. Bill Pay\n5. EMI Payment\n6. My Nagad"
        val myNagad = "My Nagad\n1. Balance Enquiry\n2. Mini Statement\n3. Change PIN\n0. Main Menu"
        val f = StatementFlow(UssdProviders.NAGAD, null, pin)
        assertEquals(UssdAction.Reply("6"), f.onScreen(nagadMain))
        assertEquals(UssdAction.Reply("2"), f.onScreen(myNagad))
        assertEquals(UssdAction.Reply("0000", secret = true), f.onScreen("Enter PIN:"))
    }

    @Test fun theListIsReadButNotUnderstood() {
        assertEquals(listOf(1, 2, 3, 4), StatementRead.entriesOn(page1))
        assertEquals(listOf(5, 6), StatementRead.entriesOn(page2))
        assertTrue(StatementRead.hasNextPage(page1))
        assertTrue(!StatementRead.hasNextPage(page2))
        assertTrue(StatementRead.listsEntry(page2, 6))
        assertTrue(!StatementRead.listsEntry(page1, 5))
        // A detail screen is not a list.
        assertTrue(StatementRead.entriesOn(detail).isEmpty())
        assertTrue(!StatementRead.lists(detail))
    }
}

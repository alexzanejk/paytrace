package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The dashboard and the phone have to agree on the names of the phone controls, and a wallet command must never be
 *  mistaken for one: a control runs without a wallet, a balance check must not. */
class PhoneActionsTest {
    @Test fun theSevenControlsAndOnlyThose() {
        assertEquals(setOf("restart", "inbox", "resend", "screen", "ring", "apprecord", "appread"), PhoneActions.KINDS)
        PhoneActions.KINDS.forEach { assertTrue(it, PhoneActions.isAction(it)) }
    }

    @Test fun walletCommandsAreNotControls() {
        // These carry a wallet and go the USSD way; routing them here would answer "unsupported" and never dial.
        assertTrue(!PhoneActions.isAction("balance"))
        assertTrue(!PhoneActions.isAction("cashin"))
        assertTrue(!PhoneActions.isAction("statement"))
        assertTrue(!PhoneActions.isAction(null))
        assertTrue(!PhoneActions.isAction(""))
    }

    @Test fun theScreenIsHeldForAWhileButNotForever() {
        assertTrue(PhoneActions.SCREEN_HOLD_MS >= 60_000L)
        assertTrue(PhoneActions.SCREEN_HOLD_MS <= 5 * 60_000L)
    }
}

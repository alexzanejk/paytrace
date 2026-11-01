package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reading the wallet's answer out of the phone's radio log, from the real lines of the owner's Redmi (2026-11-02). */
class UssdLogTest {
    // "Balance:  Tk 818.35\n0. Main Menu" as the MediaTek radio writes it.
    private val ucs2 = "00420061006C0061006E00630065003A002000200054006B0020003800310038002E00330035000A0030002E0020004D00610069006E0020004D0065006E0075"
    private val realLine = "11-02 01:45:24.512  1602  1622 D RmcSSUrc: [1] onUssd: p_str = $ucs2"

    @Test fun theBalanceIsReadFromTheLineThePhoneReallyWrote() {
        assertEquals("Balance:  Tk 818.35\n0. Main Menu", UssdLogRead.decodeUcs2(ucs2))
        assertEquals(818.35, UssdLogRead.balanceIn(listOf(realLine), NagadUssd::balanceOf)!!, 0.001)
    }

    @Test fun plainWordsAreReadToo() {
        // Other phones write the answer as it is, without the hex.
        val plain = "11-02 01:45:24 D GsmMmiCode: onUssdFinished: ussdMessage=Balance: Tk 1,234.50"
        assertEquals(1234.50, UssdLogRead.balanceIn(listOf(plain), NagadUssd::balanceOf)!!, 0.001)
    }

    @Test fun theNewestAnswerWins() {
        // The second try of that evening: "Invalid menu choice.\nBalance:  Tk 818.35\n0. Main Menu", after an older balance.
        val older = "D RmcSSUrc: onUssd: p_str = " + ucs2.replace("003800310038002E00330035", "003100300030002E00300030")
        assertEquals(100.00, UssdLogRead.balanceIn(listOf(older), NagadUssd::balanceOf)!!, 0.001)
        assertEquals(818.35, UssdLogRead.balanceIn(listOf(older, realLine), NagadUssd::balanceOf)!!, 0.001)
    }

    @Test fun anythingThatIsNotAnAnswerIsLeftAlone() {
        assertNull(UssdLogRead.balanceIn(listOf("D RILJ: [3923]> SEND_USSD ussd = ******* [PHONE1]"), NagadUssd::balanceOf))
        assertNull(UssdLogRead.balanceIn(emptyList(), NagadUssd::balanceOf))
        // Junk hex must never be turned into letters.
        assertEquals("", UssdLogRead.decodeUcs2("FFFFFFFF"))
        assertEquals("", UssdLogRead.decodeUcs2("00420061006C006"))
        assertEquals("", UssdLogRead.decodeUcs2("zzzz0061"))
        // A cash-in receipt is not a balance enquiry, so the wallet's own reader refuses it.
        val receipt = "D GsmMmiCode: ussdMessage=Cash In Tk 100.00 successful. TrxID: AB12. Balance: Tk 500.00"
        assertNull(UssdLogRead.balanceIn(listOf(receipt), NagadUssd::balanceOf))
    }

    @Test fun aLineIsNeverKeptOrShown() {
        // The dialled code (PIN included) is on those lines, so only the number ever leaves this reader.
        val withCode = "D MtkGsmCdmaPhone: dialInternal: KjE2Nyo2KjEqMDAwMCM=, mmi=GsmMmiCode {State=PENDING}"
        assertNull(UssdLogRead.balanceIn(listOf(withCode), NagadUssd::balanceOf))
        assertTrue(UssdLogRead.textsIn(withCode).all { !it.contains("Balance") })
    }

    @Test fun aRunThatEndedWithABalanceKeepsUsingTheDirectWay() {
        val minusOneButRead = "0.0s direct USSD request, SIM 1\n1.0s phone reported failure code -1\n2.5s balance read from the phone log"
        assertEquals(0, UssdDirectHealth.count(0, minusOneButRead, ok = true))
        // The same run without a balance does move the phone to the dialer way.
        assertEquals(UssdDirectHealth.ENOUGH, UssdDirectHealth.count(0, minusOneButRead, ok = false))
    }
}

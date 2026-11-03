package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SimFinderTest {
    @Test fun normalisesEveryWayANumberIsWritten() {
        assertEquals("01712345678", PhoneNumbers.normalize("01712345678"))
        assertEquals("01712345678", PhoneNumbers.normalize("+880 1712-345678"))
        assertEquals("01712345678", PhoneNumbers.normalize("8801712345678"))
        assertEquals("01712345678", PhoneNumbers.normalize(" 017 1234 5678 "))
        assertNull(PhoneNumbers.normalize("1712345678"))
        assertNull(PhoneNumbers.normalize("0171234567"))
        assertNull(PhoneNumbers.normalize("02712345678"))
        assertNull(PhoneNumbers.normalize(""))
        assertNull(PhoneNumbers.normalize(null))
    }

    @Test fun findsNumbersInsideAnOperatorsAnswer() {
        assertEquals(listOf("01712345678"), PhoneNumbers.inText("Your mobile number is 01712345678. Thank you."))
        assertEquals(listOf("01812345678"), PhoneNumbers.inText("Apnar number: +8801812345678"))
        assertEquals(listOf("01912345678", "01312345678"), PhoneNumbers.inText("01912345678 and 013-1234-5678"))
        assertEquals(emptyList<String>(), PhoneNumbers.inText("Balance: Tk 818.35"))
        assertEquals(emptyList<String>(), PhoneNumbers.inText(null))
    }

    @Test fun knowsTheOperatorsCodes() {
        assertEquals("*2#", OwnNumberCodes.codeFor("Grameenphone"))
        assertEquals("*2#", OwnNumberCodes.codeFor("GP"))
        assertEquals("*140*2*4#", OwnNumberCodes.codeFor("Robi"))
        assertEquals("*121*7*3#", OwnNumberCodes.codeFor("airtel"))
        assertEquals("*511#", OwnNumberCodes.codeFor("Banglalink"))
        assertEquals("*551#", OwnNumberCodes.codeFor("Teletalk"))
        assertNull(OwnNumberCodes.codeFor("No service"))
        assertNull(OwnNumberCodes.codeFor(""))
        assertNull(OwnNumberCodes.codeFor(null))
    }

    @Test fun matchesTheWantedNumberToItsSlot() {
        val seen = listOf(SimSeen(0, "Grameenphone", "01712345678"), SimSeen(1, "Robi", null))
        assertEquals(0, SimFinder.match("+880 1712 345678", seen))
        assertNull(SimFinder.match("01812345678", seen))
        assertNull(SimFinder.match("rubbish", seen))
    }

    @Test fun hidesTheMiddleOfANumber() {
        assertEquals("017•••••678", SimFinder.hide("01712345678"))
        assertEquals("123", SimFinder.hide("123"))
    }
}

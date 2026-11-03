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

    @Test fun knowsTheOperatorsCodesAndTriesMoreThanOne() {
        assertEquals(listOf("*2#", "*111*8#"), OwnNumberCodes.codesFor("Grameenphone"))
        assertEquals("*2#", OwnNumberCodes.codeFor("GP"))
        // Robi answers *2# or *140*2*4# depending on the guide; the owner's Robi did not answer the second alone (2026-11-04).
        assertEquals(listOf("*140*2*4#", "*2#"), OwnNumberCodes.codesFor("Robi"))
        assertEquals(listOf("*121*7*3#", "*2#"), OwnNumberCodes.codesFor("airtel"))
        assertEquals(listOf("*511#", "*666#"), OwnNumberCodes.codesFor("Banglalink"))
        assertEquals(listOf("*551#"), OwnNumberCodes.codesFor("Teletalk"))
        // An operator Android cannot name still gets the one code every Bangladeshi network answers.
        assertEquals(listOf("*2#"), OwnNumberCodes.codesFor("No service"))
        assertEquals(listOf("*2#"), OwnNumberCodes.codesFor(""))
        assertEquals(listOf("*2#"), OwnNumberCodes.codesFor(null))
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

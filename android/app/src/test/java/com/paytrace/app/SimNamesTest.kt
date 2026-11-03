package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Test

class SimNamesTest {
    private val sims = listOf(SimName(0, "Grameenphone"), SimName(1, " Robi "))

    @Test fun namesTheSimWhenAndroidTellsUs() {
        assertEquals("SIM 1 · Grameenphone", SimNames.label(0, sims))
        assertEquals("SIM 2 · Robi", SimNames.label(1, sims))
    }

    @Test fun fallsBackToThePlainNumber() {
        assertEquals("SIM 1", SimNames.label(0, emptyList()))
        assertEquals("SIM 2", SimNames.label(1, listOf(SimName(0, "Grameenphone"))))
        assertEquals("SIM 2", SimNames.label(1, listOf(SimName(1, "  "))))
    }

    @Test fun anOutOfRangeSlotIsKeptInRange() {
        assertEquals("SIM 2", SimNames.label(7, emptyList()))
        assertEquals("SIM 1", SimNames.label(-3, emptyList()))
    }
}

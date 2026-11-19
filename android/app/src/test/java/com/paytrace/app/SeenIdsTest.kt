package com.paytrace.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SeenIdsTest {
    @Test fun aRepeatedCommandIsTakenOnlyOnce() {
        val s = SeenIds()
        assertTrue(s.firstTime("dc54f752"))
        assertFalse(s.firstTime("dc54f752"))
        assertTrue(s.firstTime("ddd66b7e"))
    }

    @Test fun onlyTheNewestIdsAreKept() {
        val s = SeenIds(max = 2)
        assertTrue(s.firstTime("a"))
        assertTrue(s.firstTime("b"))
        assertTrue(s.firstTime("c"))
        assertFalse(s.firstTime("c"))
        assertTrue(s.firstTime("a"))
    }
}

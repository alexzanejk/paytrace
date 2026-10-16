package com.paytrace.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconnectGateTest {
    @Test fun theFirstUsableNetworkFires() = assertTrue(ReconnectGate().shouldFire(true, 1_000L))

    @Test fun anUnusableNetworkNeverFires() = assertFalse(ReconnectGate().shouldFire(false, 1_000L))

    @Test fun stayingOnlineDoesNotFireAgain() {
        val g = ReconnectGate()
        assertTrue(g.shouldFire(true, 1_000L))
        assertFalse(g.shouldFire(true, 60_000L)) // capability updates while still online
    }

    @Test fun comingBackAfterALossFires() {
        val g = ReconnectGate()
        assertTrue(g.shouldFire(true, 1_000L))
        assertFalse(g.shouldFire(false, 20_000L))
        assertTrue(g.shouldFire(true, 40_000L))
    }

    @Test fun aFlappingConnectionIsHeldBackForAFewSeconds() {
        val g = ReconnectGate(minGapMs = 5_000L)
        assertTrue(g.shouldFire(true, 10_000L))
        assertFalse(g.shouldFire(false, 11_000L))
        assertFalse(g.shouldFire(true, 12_000L)) // back after 2 s: too soon
        assertFalse(g.shouldFire(false, 13_000L))
        assertTrue(g.shouldFire(true, 20_000L)) // back after 10 s: fine
    }
}

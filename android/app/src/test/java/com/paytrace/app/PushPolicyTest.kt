package com.paytrace.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushPolicyTest {
    private val half = PushPolicy.RESEND_MS

    @Test fun noTokenYetMeansNothingToSend() = assertFalse(PushPolicy.shouldSend("", "", 0, 1_000))
    @Test fun aNewTokenIsSentAtOnce() = assertTrue(PushPolicy.shouldSend("new", "old", 900, 1_000))
    @Test fun theSameTokenIsNotSentAgainRightAway() = assertFalse(PushPolicy.shouldSend("t", "t", 1_000, 1_000 + half - 1))
    @Test fun theSameTokenIsSentAgainAfterHalfAnHour() = assertTrue(PushPolicy.shouldSend("t", "t", 1_000, 1_000 + half))
    @Test fun aClockThatWentBackwardsDoesNotBlockSending() = assertTrue(PushPolicy.shouldSend("t", "t", 5_000_000, 1_000))
}

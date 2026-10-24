package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Test

class StayAwakeTest {
    private val min = 60_000L
    private val start = 1_000_000L

    private fun v(now: Long, maxGap: Long, offBeats: Int, last: Long) = StayAwake.verdict(start, now, maxGap, offBeats, last)

    @Test fun noTestRunningIsNotDue() = assertEquals(StayAwake.Verdict.NOT_DUE, StayAwake.verdict(0, 5 * min, 0, 0, 0))

    @Test fun beforeTheTimeIsUpNothingIsDecided() = assertEquals(StayAwake.Verdict.NOT_DUE, v(start + 9 * min, 0, 18, start + 9 * min - 30_000))

    @Test fun steadyHeartbeatsWithTheScreenOffPass() {
        val now = start + 10 * min
        assertEquals(StayAwake.Verdict.PASS, v(now, 31_000, 18, now - 20_000))
    }

    @Test fun aLongSilenceDuringTheTestFails() {
        val now = start + 10 * min
        assertEquals(StayAwake.Verdict.FAIL, v(now, 4 * min, 18, now - 10_000))
    }

    @Test fun silenceThatIsStillGoingOnFailsEvenIfNothingRecordedIt() {
        val now = start + 10 * min
        // The service died at minute 3 and never came back, so no later heartbeat could record the gap.
        assertEquals(StayAwake.Verdict.FAIL, v(now, 30_000, 5, start + 3 * min))
    }

    @Test fun aTestWithTheScreenOnProvesNothing() {
        val now = start + 10 * min
        assertEquals(StayAwake.Verdict.TOO_LITTLE_SCREEN_OFF, v(now, 31_000, 3, now - 10_000))
    }

    @Test fun aRestartDuringTheTestCancelsIt() = assertEquals(StayAwake.Verdict.INTERRUPTED, v(start - 1, 0, 0, 0))

    @Test fun exactlyTheLimitStillPasses() {
        val now = start + 10 * min
        assertEquals(StayAwake.Verdict.PASS, v(now, StayAwake.OK_GAP_MS, StayAwake.MIN_SCREEN_OFF_BEATS, now - 5_000))
    }
}

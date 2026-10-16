package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BeatGapTest {
    private val minute = 60_000L

    @Test fun neverRanBeforeIsNotAStop() = assertNull(BeatGap.stoppedMinutes(0L, 10 * minute))

    @Test fun aNormalThirtySecondGapIsNotAStop() = assertNull(BeatGap.stoppedMinutes(100 * minute, 100 * minute + 30_000L))

    @Test fun justUnderFiveMinutesIsNotAStop() = assertNull(BeatGap.stoppedMinutes(100 * minute, 100 * minute + 5 * minute - 1))

    @Test fun fiveMinutesOrMoreIsAStop() = assertEquals(5L, BeatGap.stoppedMinutes(100 * minute, 105 * minute))

    @Test fun theLengthIsReportedInWholeMinutes() = assertEquals(47L, BeatGap.stoppedMinutes(100 * minute, 147 * minute + 20_000L))

    @Test fun aPhoneRestartIsNotAStop() = assertNull(BeatGap.stoppedMinutes(5_000 * minute, 3 * minute))
}

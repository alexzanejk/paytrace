package com.paytrace.app

import org.junit.Assert.assertTrue
import org.junit.Test

class KeepaliveTest {
    @Test fun aStoppedAppComesBackWithinTenSeconds() = assertTrue(Keepalive.SOON_MS in 1_000L..10_000L)

    @Test fun aSilentlyKilledAppComesBackWithinAMinute() = assertTrue(Keepalive.RING_AFTER_MS <= 60_000L)

    // The heartbeat runs every 30 s and pushes the alarm forward each time, so a healthy app never lets it ring.
    @Test fun theNormalAlarmIsLongerThanOneHeartbeat() = assertTrue(Keepalive.RING_AFTER_MS > MonitorService.BEAT_MS)

    @Test fun theQuickRestartIsFasterThanTheNormalAlarm() = assertTrue(Keepalive.SOON_MS < Keepalive.RING_AFTER_MS)

    @Test fun theStrongBackupIsSlowerThanTheQuickOneButStillWithinMinutes() {
        assertTrue(Keepalive.STRONG_AFTER_MS > Keepalive.RING_AFTER_MS)
        assertTrue(Keepalive.STRONG_AFTER_MS <= 10 * 60_000L)
    }

    @Test fun theInboxIsReReadAtLeastEveryTenMinutes() =
        assertTrue(MonitorService.INBOX_EVERY_BEATS * MonitorService.BEAT_MS in 60_000L..10 * 60_000L)
}

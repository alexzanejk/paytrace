package com.paytrace.app

/** Tells apart "the phone's battery manager stopped PayTrace" from "the phone was switched off". Pure, so it is unit tested. */
object BeatGap {
    /** Longer than this without a heartbeat while the phone stayed on means Android (or the phone brand's own power
     *  manager) stopped the app. Normal gaps are 30 seconds. */
    const val STOPPED_AFTER_MS = 5 * 60_000L

    /** Minutes the app was stopped for, or null if it was not (never ran before, phone restarted, or the gap is normal).
     *  `elapsed*` is the phone's uptime clock, which counts sleep but restarts from zero when the phone reboots. */
    fun stoppedMinutes(lastBeatElapsed: Long, nowElapsed: Long): Long? {
        if (lastBeatElapsed <= 0L) return null
        if (nowElapsed < lastBeatElapsed) return null // the phone restarted since: a reboot is not a kill
        val gap = nowElapsed - lastBeatElapsed
        return if (gap >= STOPPED_AFTER_MS) gap / 60_000L else null
    }
}

package com.paytrace.app

import android.content.Context
import android.os.PowerManager
import android.os.SystemClock

/** A real test of the thing that matters: does PayTrace keep running with the screen off? The owner starts it, locks the phone and waits.
 *  While it runs, every heartbeat of the always-on service records how long it was since the previous one and whether the screen was off.
 *  When the owner comes back, the verdict is decided here (pure, so it is unit tested): any silence longer than [OK_GAP_MS] means the phone
 *  stopped PayTrace, which is exactly what makes the dashboard show Offline. */
object StayAwake {
    const val TEST_MS = 10 * 60_000L

    /** The dashboard shows Offline after 90 seconds of silence. A gap above this means the phone really stopped the app. */
    const val OK_GAP_MS = 120_000L

    /** At least this many heartbeats (30 s apart) must have been seen with the screen off, i.e. about 5 minutes. */
    const val MIN_SCREEN_OFF_BEATS = 10

    enum class Verdict { NOT_DUE, PASS, FAIL, TOO_LITTLE_SCREEN_OFF, INTERRUPTED }

    /** [elapsedNow] and [startElapsed] are the phone's uptime clock (which restarts at a reboot). */
    fun verdict(startElapsed: Long, elapsedNow: Long, maxGapMs: Long, screenOffBeats: Int, lastBeatElapsed: Long): Verdict {
        if (startElapsed <= 0L) return Verdict.NOT_DUE
        if (elapsedNow < startElapsed) return Verdict.INTERRUPTED // the phone restarted during the test
        if (elapsedNow - startElapsed < TEST_MS) return Verdict.NOT_DUE
        // The silence that is still going on counts too: a dead service never records its own last gap.
        val ongoing = if (lastBeatElapsed > 0L) elapsedNow - lastBeatElapsed else 0L
        if (maxOf(maxGapMs, ongoing) > OK_GAP_MS) return Verdict.FAIL
        if (screenOffBeats < MIN_SCREEN_OFF_BEATS) return Verdict.TOO_LITTLE_SCREEN_OFF
        return Verdict.PASS
    }

    fun start(s: AppSettings) {
        s.testStartElapsed = SystemClock.elapsedRealtime()
        s.testStartedAt = System.currentTimeMillis()
        s.testMaxGapMs = 0L
        s.testScreenOffBeats = 0
    }

    fun cancel(s: AppSettings) {
        s.testStartElapsed = 0L
        s.testStartedAt = 0L
    }

    fun running(s: AppSettings) = s.testStartElapsed > 0L

    /** Called by the always-on service on every heartbeat, BEFORE it records the new beat time. */
    fun onBeat(ctx: Context, s: AppSettings, elapsedNow: Long) {
        if (!running(s)) return
        val last = s.lastBeatElapsed
        if (last > 0L && elapsedNow >= last) s.testMaxGapMs = maxOf(s.testMaxGapMs, elapsedNow - last)
        try {
            val pm = ctx.getSystemService(PowerManager::class.java)
            if (pm != null && !pm.isInteractive) s.testScreenOffBeats += 1
        } catch (e: Exception) {
        }
    }

    /** Looks at a running test and, if its time is up, stores the result. Returns the verdict. Cheap: call it whenever the screen is shown. */
    fun finishIfDue(s: AppSettings): Verdict {
        if (!running(s)) return Verdict.NOT_DUE
        val v = verdict(s.testStartElapsed, SystemClock.elapsedRealtime(), s.testMaxGapMs, s.testScreenOffBeats, s.lastBeatElapsed)
        when (v) {
            Verdict.NOT_DUE -> Unit
            Verdict.INTERRUPTED -> cancel(s)
            else -> {
                s.testResult = when (v) { Verdict.PASS -> "pass"; Verdict.FAIL -> "fail"; else -> "short" }
                s.testResultAt = System.currentTimeMillis()
                s.testResultGapS = (maxOf(s.testMaxGapMs, if (s.lastBeatElapsed > 0L) SystemClock.elapsedRealtime() - s.lastBeatElapsed else 0L) / 1000L).toInt()
                s.testScreenOffMin = s.testScreenOffBeats / 2
                cancel(s)
            }
        }
        return v
    }

    /** Minutes left of a running test, rounded up. */
    fun minutesLeft(s: AppSettings): Int {
        val left = TEST_MS - (SystemClock.elapsedRealtime() - s.testStartElapsed)
        return ((left + 59_999L) / 60_000L).toInt().coerceAtLeast(0)
    }
}

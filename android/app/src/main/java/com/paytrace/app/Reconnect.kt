package com.paytrace.app

import android.content.Context

/** Decides when "the internet is back" is worth acting on. Pure, so it can be unit tested. */
class ReconnectGate(private val minGapMs: Long = 5_000L) {
    private var wasOnline = false
    private var lastFiredAt = Long.MIN_VALUE

    /** Call with every change of the network's state. True only when it has just become usable, and not more than
     *  once every few seconds: a flapping connection must not hammer the server or use up message retries. */
    fun shouldFire(usable: Boolean, nowMs: Long): Boolean {
        val justCameBack = usable && !wasOnline
        wasOnline = usable
        if (!justCameBack) return false
        if (lastFiredAt != Long.MIN_VALUE && nowMs - lastFiredAt < minGapMs) return false
        lastFiredAt = nowMs
        return true
    }
}

object Reconnect {
    /** Messages that failed only because there was no internet (not because the server refused them) get another go,
     *  as long as they are recent. The server ignores a message it already has, so a repeat is harmless. */
    private const val RETRY_WINDOW_MS = 24 * 60 * 60 * 1000L

    /** Called the moment the internet is usable again: send everything waiting right now, and tell the dashboard. */
    fun onInternetBack(ctx: Context) {
        try {
            val db = Db.get(ctx)
            for (id in db.retryableFailedIds(System.currentTimeMillis() - RETRY_WINDOW_MS)) db.resetForRetry(id)
            SendWorker.resumePending(ctx)
        } catch (e: Exception) {
            // The regular retries still run; this is only a faster path.
        }
        try {
            InboxScanner.run(ctx) // anything that arrived while the internet was down is also re-read from the phone's inbox
        } catch (e: Exception) {
        }
        try {
            HeartbeatWorker.beat(ctx)
        } catch (e: Exception) {
        }
    }
}

package com.paytrace.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Ways back if the phone's power manager stops the app. Two alarms are pushed forward on every heartbeat, so while
 *  PayTrace is healthy neither ever rings:
 *   - a quick one (45 seconds): if the service dies silently it is started again and a heartbeat is sent straight from the alarm;
 *   - a strong one (5 minutes) set as an "alarm clock", which phone brands almost never cancel or delay, even in deep sleep.
 *     The price is the little alarm icon in the status bar, and the lock screen's "next alarm" showing PayTrace's time.
 *  If the app is told it is being stopped (swiped away, service destroyed) it asks to be started again in 5 seconds.
 *  Starting the service from an alarm is allowed because PayTrace is exempt from battery optimisation. */
object Keepalive {
    /** Normal "start me again if I stop beating" alarm. A little longer than the 30-second heartbeat. */
    const val RING_AFTER_MS = 45_000L

    /** After the app is told it is being stopped: come straight back. */
    const val SOON_MS = 5_000L

    /** The alarm-clock style backup. */
    const val STRONG_AFTER_MS = 5 * 60_000L

    const val ACTION_REPOST = "com.paytrace.app.REPOST_NOTICE"

    private fun pending(ctx: Context, code: Int, action: String? = null): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, KeepaliveReceiver::class.java).also { if (action != null) it.action = action },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Brings the notice back if someone swipes it away (Android 14 and later allow that). */
    fun repostIntent(ctx: Context): PendingIntent = pending(ctx, 79, ACTION_REPOST)

    /** Safe to call as often as you like: it replaces the previous alarms. */
    fun schedule(ctx: Context, afterMs: Long = RING_AFTER_MS) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + afterMs, pending(ctx, 77))
        } catch (e: Exception) {
            // The alarms are extra safety nets; never let them break the heartbeat.
        }
        try {
            if (AppSettings(ctx).strongAlarm) {
                val open = PendingIntent.getActivity(
                    ctx, 78, Intent(ctx, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                am.setAlarmClock(AlarmManager.AlarmClockInfo(System.currentTimeMillis() + STRONG_AFTER_MS, open), pending(ctx, 80))
            } else {
                am.cancel(pending(ctx, 80))
            }
        } catch (e: Exception) {
        }
    }
}

class KeepaliveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MonitorService.start(context)
        Keepalive.schedule(context)
        if (intent.action == Keepalive.ACTION_REPOST) return
        // Do not wait for the service: say "I am online" right now, so the dashboard is right even if Android is slow
        // to let the service start.
        val pending = goAsync()
        Thread({
            try {
                HeartbeatWorker.beat(context.applicationContext)
            } catch (e: Exception) {
            } finally {
                pending.finish()
            }
        }, "paytrace-alarm-beat").start()
    }
}

package com.paytrace.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** A second way back if the phone's power manager stops the app: an alarm that is pushed forward on every heartbeat,
 *  so while PayTrace is healthy it never rings. If the service dies silently, the alarm rings within about 45 seconds;
 *  if the app is told it is being stopped (swiped away, service destroyed) it asks to be started again in 5 seconds.
 *  Either way it starts the service again (allowed because PayTrace is exempt from battery optimisation). Some phone brands also cancel
 *  alarms when they stop an app; then only the phone's own settings (see the setup page) can help. */
object Keepalive {
    /** Normal "start me again if I stop beating" alarm. A little longer than the 30-second heartbeat. */
    const val RING_AFTER_MS = 45_000L

    /** After the app is told it is being stopped: come straight back. */
    const val SOON_MS = 5_000L

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, 77, Intent(ctx, KeepaliveReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Safe to call as often as you like: it replaces the previous alarm. */
    fun schedule(ctx: Context, afterMs: Long = RING_AFTER_MS) {
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + afterMs, pending(ctx))
        } catch (e: Exception) {
            // The alarm is an extra safety net; never let it break the heartbeat.
        }
    }
}

class KeepaliveReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MonitorService.start(context)
        Keepalive.schedule(context)
    }
}

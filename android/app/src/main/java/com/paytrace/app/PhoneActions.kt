package com.paytrace.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/** Phone controls the dashboard can send (owner request 2026-11-02). None of them touches a wallet or moves money.
 *
 *  They ride on the same command path as a balance check — queued on the dashboard, taken on the heartbeat reply,
 *  answered with command_result — so there is no new mechanism on the server and no new Edge call.
 *
 *  What is NOT here, because Android gives no app a way to do it and the owner was told so: switching a phone on from
 *  off, rebooting it, or toggling Wi-Fi / mobile data / flight mode. */
object PhoneActions {
    const val RESTART = "restart"
    const val INBOX = "inbox"
    const val RESEND = "resend"
    const val SCREEN = "screen"
    const val RING = "ring"
    /** Test: read the bKash app's screens while a person uses it (owner 2026-11-10). Reads only, never taps. */
    const val APP_RECORD = AppRecorder.KIND
    /** Reads the bKash app's transaction list (every 30 minutes from the server, or the phone card's button). */
    const val APP_READ = AppReader.KIND

    /** The dashboard's list (lib/phoneCommands.ts PHONE_ACTIONS) must name exactly these. */
    val KINDS: Set<String> = setOf(RESTART, INBOX, RESEND, SCREEN, RING, APP_RECORD, APP_READ)

    fun isAction(kind: String?): Boolean = kind != null && kind in KINDS

    /** How long "wake the screen" keeps it lit. Long enough to look at it, short enough to cost nothing. */
    const val SCREEN_HOLD_MS = 120_000L

    /** Runs one control and reports through [done]. Called on the heartbeat thread, so the work may block; the
     *  report is handed over BEFORE anything that could stop this very thread (a restart does). */
    fun run(ctx: Context, kind: String, look: AppLook? = null, commandId: String? = null, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        when (kind) {
            RESTART -> {
                // Answer first: stopping the service interrupts the beat thread we are standing on.
                done(UssdOutcome(true, null, null))
                Handler(Looper.getMainLooper()).postDelayed({ restart(app) }, 500)
            }
            INBOX -> {
                val n = try { InboxScanner.run(app) } catch (e: Exception) { -1 }
                // -1 is the scanner's own word for "could not read the inbox" (no permission, paused, or the read failed).
                done(if (n >= 0) UssdOutcome(true, null, null) else UssdOutcome(false, null, "inbox_unreadable"))
            }
            RESEND -> {
                try { Reconnect.onInternetBack(app) } catch (e: Exception) { }
                done(UssdOutcome(true, null, null))
            }
            SCREEN -> {
                wakeAndHold(app)
                done(UssdOutcome(true, null, null))
            }
            RING -> {
                ring(app)
                done(UssdOutcome(true, null, null))
            }
            APP_RECORD -> {
                // Reading a wallet's screens is a balance-check kind of thing: it follows the same dashboard switch.
                if (!AppSettings(app).ussdAllowed) return done(UssdOutcome(false, null, "not_allowed"))
                Handler(Looper.getMainLooper()).post { AppRecorder.start(app, commandId, done) }
            }
            APP_READ -> Handler(Looper.getMainLooper()).post { AppReader.start(app, look, done) }
            else -> done(UssdOutcome(false, null, "unsupported"))
        }
    }

    /** Stop and start the always-on service and re-arm the safety nets around it. onDestroy already schedules a 5 s
     *  come-back alarm, so even if the start below were refused the phone would be back within seconds. */
    private fun restart(app: Context) {
        try { app.stopService(Intent(app, MonitorService::class.java)) } catch (e: Exception) { }
        try { MonitorService.start(app) } catch (e: Exception) { }
        try { HeartbeatWorker.schedule(app) } catch (e: Exception) { }
        try { SendWorker.resumePending(app) } catch (e: Exception) { }
        try { HeartbeatWorker.now(app) } catch (e: Exception) { }
    }

    /** Light the screen (pushing aside a lock screen that protects nothing) and keep it on for [SCREEN_HOLD_MS]. A
     *  phone with a real lock still lights up; it just shows its lock screen, which is as it should be. */
    private fun wakeAndHold(app: Context) {
        try { ScreenWake.wakeUp(app) } catch (e: Exception) { }
        try {
            val pm = app.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
            @Suppress("DEPRECATION")
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "paytrace:screen")
                .acquire(SCREEN_HOLD_MS)
        } catch (e: Exception) {
            // Some phones refuse screen wake locks to background apps; the wake window above still lit it.
        }
    }

    /** The job alarm's own sound and vibration, plus a notice saying who is calling and why, so a partner is not
     *  alarmed by a phone that suddenly rings for no visible reason. */
    private fun ring(app: Context) {
        try {
            val nm = app.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Owner is looking for this phone", NotificationManager.IMPORTANCE_HIGH),
            )
            val open = PendingIntent.getActivity(
                app, 41, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            nm.notify(
                NOTIF_ID,
                NotificationCompat.Builder(app, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("The dashboard is looking for this phone")
                    .setContentText("Please keep PayTrace open and the phone charged.")
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .build(),
            )
        } catch (e: Exception) {
        }
        try { JobAlarm.ring(app) } catch (e: Exception) { }
    }

    private const val CHANNEL = "find_phone"
    private const val NOTIF_ID = 41
}

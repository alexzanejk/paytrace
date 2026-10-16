package com.paytrace.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat

/** Always on. Keeps a visible notification up so Android is less likely to stop the app, and tells the server
 *  "this phone is online" every 30 seconds, so the dashboard can show Offline within about a minute and a half. */
class MonitorService : Service() {
    @Volatile private var running = false
    private var thread: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastNotice = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Payment monitoring", NotificationManager.IMPORTANCE_LOW)
        )
    }

    private fun notice(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("PayTrace is watching for payments")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    /** What the notification says right now: all fine, paused, or something to fix. */
    private fun statusText(): String {
        val s = AppSettings(this)
        return when {
            Setup.missing(this, s).isNotEmpty() -> "Action needed: tap to finish setup, or payments may be missed"
            !s.monitoring -> "Paused: payments are NOT being forwarded"
            else -> "bKash, Nagad, Rocket and Upay SMS are forwarded to your server"
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastNotice = statusText()
        val n = notice(lastNotice)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIF_ID, n)
        }
        // Without this the processor can doze between heartbeats while the screen is off.
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paytrace:monitor")
                ?.apply { setReferenceCounted(false); acquire() }
        }
        startBeating()
        return START_STICKY
    }

    private fun startBeating() {
        if (thread?.isAlive == true) return
        running = true
        thread = Thread({
            while (running) {
                try {
                    HeartbeatWorker.beat(applicationContext)
                } catch (e: Exception) {
                    // One failed heartbeat (no internet) must never stop the loop; the next one is 30 seconds away.
                }
                try {
                    val text = statusText()
                    if (text != lastNotice) {
                        lastNotice = text
                        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notice(text))
                    }
                } catch (e: Exception) {
                }
                try {
                    Thread.sleep(BEAT_MS)
                } catch (e: InterruptedException) {
                    break
                }
            }
        }, "paytrace-heartbeat").also { it.isDaemon = true; it.start() }
    }

    override fun onDestroy() {
        running = false
        thread?.interrupt()
        thread = null
        try { wakeLock?.release() } catch (e: Exception) { }
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "monitor"
        private const val NOTIF_ID = 1

        /** How often this phone says "I am online". The dashboard calls a phone Offline after three missed ones. */
        const val BEAT_MS = 30_000L

        fun start(ctx: Context) {
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, MonitorService::class.java))
            } catch (e: Exception) {
                // Android may refuse a background start; the SMS receiver still works without it.
            }
        }
    }
}

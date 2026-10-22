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
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.content.ContextCompat

/** Always on. Keeps a visible notification up so Android is less likely to stop the app, and tells the server
 *  "this phone is online" every 30 seconds, so the dashboard can show Offline within about a minute and a half. */
class MonitorService : Service() {
    @Volatile private var running = false
    private var thread: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var lastNotice = ""
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private val reconnectGate = ReconnectGate()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        // The old channel was "low" importance, which some phone brands hide and treat as unimportant. This one is shown
        // normally in the status bar but makes no sound and no vibration.
        try { nm.deleteNotificationChannel("monitor") } catch (e: Exception) { }
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Payment monitoring", NotificationManager.IMPORTANCE_DEFAULT).apply {
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
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
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
            .setDeleteIntent(Keepalive.repostIntent(this)) // swiped away: it comes straight back
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
        // If the last heartbeat was long ago and the phone did not restart, the phone's power manager stopped us.
        // Count it, so the dashboard can show it and the owner knows the phone's battery settings need attention.
        try {
            val settings = AppSettings(this)
            val gap = BeatGap.stoppedMinutes(settings.lastBeatElapsed, SystemClock.elapsedRealtime())
            if (gap != null) {
                settings.stoppedCount += 1
                settings.lastGapMin = gap.toInt()
            }
            settings.lastBeatElapsed = SystemClock.elapsedRealtime()
        } catch (e: Exception) {
        }

        lastNotice = statusText()
        val n = notice(lastNotice)
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIF_ID, n)
            }
        } catch (e: Exception) {
            // Android refused to show the notice (for example a restart from the background). Keep checking in anyway
            // while the process lives; a crash here would only make things worse.
        }
        // Without these the processor and Wi-Fi can doze between heartbeats while the screen is off.
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "paytrace:monitor")
                ?.apply { setReferenceCounted(false); acquire() }
        }
        if (wifiLock == null) {
            try {
                @Suppress("DEPRECATION")
                wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
                    ?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "paytrace:wifi")
                    ?.apply { setReferenceCounted(false); acquire() }
            } catch (e: Exception) {
            }
        }
        Keepalive.schedule(this)
        Push.refresh(this)
        watchNetwork()
        startBeating()
        return START_STICKY
    }

    /** The owner swiped PayTrace out of the recent-apps list. Some phones stop the whole app when that happens, so ask
     *  to be started again right away. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            Keepalive.schedule(this, Keepalive.SOON_MS)
            start(applicationContext)
        } catch (e: Exception) {
        }
        super.onTaskRemoved(rootIntent)
    }

    /** The moment the internet is usable again, send everything that was waiting and tell the dashboard, instead of
     *  waiting for the next scheduled retry. */
    private fun watchNetwork() {
        if (netCallback != null) return
        try {
            val cm = getSystemService(ConnectivityManager::class.java) ?: return
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    val usable = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                    if (reconnectGate.shouldFire(usable, SystemClock.elapsedRealtime())) {
                        Thread({ Reconnect.onInternetBack(applicationContext) }, "paytrace-reconnect").start()
                    }
                }

                override fun onLost(network: Network) {
                    reconnectGate.shouldFire(false, SystemClock.elapsedRealtime())
                }
            }
            cm.registerDefaultNetworkCallback(cb)
            netCallback = cb
        } catch (e: Exception) {
            // Without it the regular retries and the 30-second loop still work.
        }
    }

    private fun startBeating() {
        if (thread?.isAlive == true) return
        running = true
        thread = Thread({
            var beat = 0
            while (running) {
                // Re-read the SMS inbox for payment messages that were missed: when the service starts, then every few minutes.
                if (beat % INBOX_EVERY_BEATS == 0) {
                    try { InboxScanner.run(applicationContext) } catch (e: Exception) { }
                }
                beat++
                try {
                    AppSettings(applicationContext).lastBeatElapsed = SystemClock.elapsedRealtime()
                    HeartbeatWorker.beat(applicationContext)
                    Keepalive.schedule(applicationContext) // pushes the "start me again" alarm forward while healthy
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
        // Android is stopping the service (not us: nothing here ever stops it on purpose). Ask to be started again in 5 seconds.
        try { Keepalive.schedule(applicationContext, Keepalive.SOON_MS) } catch (e: Exception) { }
        try { netCallback?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) } } catch (e: Exception) { }
        netCallback = null
        running = false
        thread?.interrupt()
        thread = null
        try { wakeLock?.release() } catch (e: Exception) { }
        wakeLock = null
        try { wifiLock?.release() } catch (e: Exception) { }
        wifiLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "monitor_v2"
        private const val NOTIF_ID = 1

        /** How often this phone says "I am online". The dashboard calls a phone Offline after three missed ones. */
        const val BEAT_MS = 30_000L

        /** The inbox is re-read every this many heartbeats (10 x 30 s = 5 minutes). */
        const val INBOX_EVERY_BEATS = 10

        fun start(ctx: Context) {
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, MonitorService::class.java))
            } catch (e: Exception) {
                // Android may refuse a background start; the SMS receiver still works without it.
            }
        }
    }
}

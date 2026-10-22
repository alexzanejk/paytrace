package com.paytrace.app

import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** When the push address goes into a heartbeat: when it is new, then again every half hour (the server keeps it). */
object PushPolicy {
    const val RESEND_MS = 30L * 60 * 1000

    fun shouldSend(token: String, lastSentToken: String, lastSentAt: Long, now: Long): Boolean =
        token.isNotEmpty() && (token != lastSentToken || now - lastSentAt >= RESEND_MS || lastSentAt > now)
}

object Push {
    /** Asks Firebase for this phone's push address. Quietly does nothing when this build has no Firebase set up. */
    fun refresh(ctx: Context) {
        try {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrEmpty()) {
                    AppSettings(ctx.applicationContext).pushToken = token
                    Thread({ try { HeartbeatWorker.beat(ctx.applicationContext) } catch (e: Exception) { } }, "paytrace-push-token").start()
                }
            }
        } catch (e: Throwable) {
            // No google-services.json in this build, or Google Play services missing: the rest of the app works without it.
        }
    }
}

/** Receives Firebase's wake-up. A high-priority message is allowed to start the always-on service even when the phone
 *  brand had stopped the app, so this is the way back from a silent kill. */
class WakeService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        AppSettings(applicationContext).pushToken = token
        val ctx = applicationContext
        Thread({ try { HeartbeatWorker.beat(ctx) } catch (e: Exception) { } }, "paytrace-push-token").start()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val ctx = applicationContext
        MonitorService.start(ctx)
        try { Keepalive.schedule(ctx) } catch (e: Exception) { }
        // Tell the dashboard straight away, then pick up anything missed while the app was stopped.
        try { HeartbeatWorker.beat(ctx) } catch (e: Exception) { }
        try { InboxScanner.run(ctx) } catch (e: Exception) { }
    }
}

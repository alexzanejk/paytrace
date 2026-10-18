package com.paytrace.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** What happens to one incoming SMS, shared by the normal listener and the default-SMS-app listener. */
object SmsIntake {
    /** Runs `work` on a background thread while holding a short wake lock, and keeps the receiver alive until it is done, so
     *  Android cannot put the phone back to sleep halfway through saving or queueing a message. Also makes sure the
     *  always-on service is running (an SMS arriving is a good moment to revive it). */
    fun runAwake(ctx: Context, receiver: android.content.BroadcastReceiver, work: () -> Unit) {
        val pending = receiver.goAsync()
        val wl = try {
            ctx.getSystemService(android.os.PowerManager::class.java)
                ?.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "paytrace:sms")
                ?.apply { setReferenceCounted(false); acquire(20_000L) }
        } catch (e: Exception) {
            null
        }
        Thread({
            try {
                try { MonitorService.start(ctx.applicationContext) } catch (e: Exception) { }
                work()
            } catch (e: Exception) {
                // Whatever happened, the inbox scan later picks the message up.
            } finally {
                try { if (wl?.isHeld == true) wl.release() } catch (e: Exception) { }
                pending.finish()
            }
        }, "paytrace-sms").start()
    }

    /** Keeps payment messages from the four providers and queues them for the server. Safe to call twice for the same
     *  message: the second copy is recognised and ignored. */
    fun handlePayment(ctx: Context, sender: String, body: String, receivedAt: Long? = null) {
        val provider = Providers.fromSender(sender) ?: return
        val settings = AppSettings(ctx)
        if (!settings.providerEnabled(provider)) return
        if (!settings.monitoring) return // paused by the owner; the inbox scan picks these up when monitoring resumes
        if (body.isBlank()) return
        val id = Db.get(ctx).insertIfNew(provider, sender, body, Providers.quick(body), receivedAt)
        if (id > 0) SendWorker.enqueue(ctx, id, 0)
    }

    /** Only when PayTrace is the default SMS app: Android no longer saves messages itself, so PayTrace must put each one
     *  in the phone's inbox, or it would vanish. Returns true if saved. */
    fun saveToInbox(ctx: Context, sender: String, body: String, dateMs: Long): Boolean = try {
        val v = ContentValues()
        v.put(Telephony.Sms.ADDRESS, sender)
        v.put(Telephony.Sms.BODY, body)
        v.put(Telephony.Sms.DATE, dateMs)
        v.put(Telephony.Sms.DATE_SENT, dateMs)
        v.put(Telephony.Sms.READ, 0)
        v.put(Telephony.Sms.SEEN, 0)
        v.put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_INBOX)
        ctx.contentResolver.insert(Telephony.Sms.Inbox.CONTENT_URI, v) != null
    } catch (e: Exception) {
        false
    }

    private const val CHANNEL = "other_sms"

    /** One notification per sender, so a new message from the same person replaces the old one and "seen" can clear it. */
    fun notificationId(address: String): Int = address.hashCode()

    /** A normal notification for messages that are not payments (bank codes, friends), because in SMS app mode PayTrace is
     *  the only app that sees them arrive. */
    fun notifyOther(ctx: Context, sender: String, body: String) {
        try {
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Other text messages", NotificationManager.IMPORTANCE_HIGH))
            val id = notificationId(sender)
            val open = PendingIntent.getActivity(
                ctx, id, Intent(ctx, MainActivity::class.java).putExtra(MainActivity.EXTRA_OPEN_THREAD, sender),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val markRead = PendingIntent.getBroadcast(
                ctx, id, Intent(ctx, MarkReadReceiver::class.java).putExtra("address", sender),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = android.app.Notification.Builder(ctx, CHANNEL)
                .setContentTitle(sender)
                .setContentText(body)
                .setStyle(android.app.Notification.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(open)
                .setAutoCancel(true)
                .addAction(android.app.Notification.Action.Builder(null, "Mark as read", markRead).build())
                .build()
            nm.notify(id, n)
        } catch (e: Exception) {
        }
    }
}

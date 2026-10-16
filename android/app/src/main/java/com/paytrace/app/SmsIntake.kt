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

    /** A normal notification for messages that are not payments (bank codes, friends), because in SMS app mode PayTrace is
     *  the only app that sees them arrive. */
    fun notifyOther(ctx: Context, sender: String, body: String) {
        try {
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Other text messages", NotificationManager.IMPORTANCE_HIGH))
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = android.app.Notification.Builder(ctx, CHANNEL)
                .setContentTitle(sender)
                .setContentText(body)
                .setStyle(android.app.Notification.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            nm.notify((sender + body).hashCode(), n)
        } catch (e: Exception) {
        }
    }
}

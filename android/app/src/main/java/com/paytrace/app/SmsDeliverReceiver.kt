package com.paytrace.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Used only when PayTrace is the phone's default SMS app (Android sends SMS_DELIVER to that app alone). Every message
 *  is saved to the phone's inbox FIRST, so nothing is lost even if the payment handling below fails. */
class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return
        val sender = parts[0].originatingAddress ?: return
        val body = parts.joinToString("") { it.messageBody ?: "" }
        val date = parts[0].timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
        val slot = SimSlot.fromIntent(context, intent)
        // The SIM goes into the inbox row too: as the SMS app, PayTrace is the only one who will ever write it there
        // (owner 2026-11-08: no app could show the SIM of a message on a phone where PayTrace is the SMS app).
        val subId = SimSlot.subscriptionFromIntent(intent)

        SmsIntake.runAwake(context, this) {
            SmsIntake.saveToInbox(context, sender, body, date, subId)
            try {
                if (Providers.fromSender(sender) != null) SmsIntake.handlePayment(context, sender, body, date, slot)
                else SmsIntake.notifyOther(context, sender, body)
            } catch (e: Exception) {
                // The message is already safe in the inbox; the inbox scan will pick the payment up later.
            }
        }
    }
}

/** Android requires a default SMS app to accept picture messages. PayTrace does not handle them. */
class MmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {}
}

/** "Reply by message" from the call screen: sends the chosen quick reply. */
class RespondViaMessageService : android.app.Service() {
    override fun onBind(intent: Intent?): android.os.IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val to = intent?.data?.schemeSpecificPart?.substringBefore('?')
            val text = intent?.getStringExtra(Intent.EXTRA_TEXT)
            if (!to.isNullOrBlank() && !text.isNullOrBlank()) SmsStore.send(applicationContext, to, text)
        } catch (e: Exception) {
        }
        stopSelf(startId)
        return START_NOT_STICKY
    }
}

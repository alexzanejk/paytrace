package com.paytrace.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Catches every incoming SMS while PayTrace is a normal app. Only messages from a known provider sender ID (and only
 *  providers that are switched on) are kept. When PayTrace is the default SMS app, [SmsDeliverReceiver] does this instead. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return

        val sender = parts[0].originatingAddress ?: return
        // Long messages arrive in several parts; join them back together.
        val body = parts.joinToString("") { it.messageBody ?: "" }
        SmsIntake.handlePayment(context, sender, body)
    }
}

package com.paytrace.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Catches every incoming SMS. Only messages from a known provider sender ID (and only providers that are switched on) are kept. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        if (parts.isEmpty()) return

        val sender = parts[0].originatingAddress ?: return
        val provider = Providers.fromSender(sender) ?: return
        val settings = AppSettings(context)
        if (!settings.providerEnabled(provider)) return

        // Long messages arrive in several parts; join them back together.
        val body = parts.joinToString("") { it.messageBody ?: "" }
        if (body.isBlank()) return

        val id = Db.get(context).insertIfNew(provider, sender, body, Providers.quick(body))
        if (id > 0) SendWorker.enqueue(context, id, 0)
    }
}

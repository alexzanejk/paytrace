package com.paytrace.app

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsManager
import androidx.core.content.ContextCompat

/** Reading, marking as seen and sending text messages through the phone's own message database. Writing and sending only
 *  work while PayTrace is the phone's SMS app (SMS app mode), because Android gives only that app the right to. */
object SmsStore {
    sealed class SendResult {
        object Ok : SendResult()
        data class Failed(val why: String) : SendResult()
    }

    private val PROJECTION = arrayOf(
        Telephony.Sms._ID, Telephony.Sms.THREAD_ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY,
        Telephony.Sms.DATE, Telephony.Sms.TYPE, Telephony.Sms.READ, Telephony.Sms.STATUS,
    )

    private fun android.database.Cursor.toRow() = SmsRow(
        id = getLong(0), threadId = getLong(1), address = getString(2) ?: "", body = getString(3) ?: "",
        date = getLong(4), type = getInt(5), read = getInt(6) == 1, status = getInt(7),
    )

    fun canRead(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    fun canSend(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

    /** The newest messages, for the conversation list. */
    fun recent(ctx: Context, limit: Int = 1500): List<SmsRow> = try {
        val out = ArrayList<SmsRow>()
        ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, PROJECTION, null, null, "${Telephony.Sms.DATE} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out.add(c.toRow())
        }
        out
    } catch (e: Exception) {
        emptyList()
    }

    /** One conversation, oldest first. */
    fun thread(ctx: Context, threadId: Long, address: String, limit: Int = 500): List<SmsRow> = try {
        val out = ArrayList<SmsRow>()
        val (where, args) = if (threadId > 0) "${Telephony.Sms.THREAD_ID} = ?" to arrayOf(threadId.toString())
        else "${Telephony.Sms.ADDRESS} = ?" to arrayOf(address)
        ctx.contentResolver.query(Telephony.Sms.CONTENT_URI, PROJECTION, where, args, "${Telephony.Sms.DATE} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out.add(c.toRow())
        }
        out.reversed()
    } catch (e: Exception) {
        emptyList()
    }

    /** "Seen": marks a whole conversation as read and removes its notification. */
    fun markRead(ctx: Context, threadId: Long, address: String) {
        try {
            val v = ContentValues().apply { put(Telephony.Sms.READ, 1); put(Telephony.Sms.SEEN, 1) }
            if (threadId > 0) {
                ctx.contentResolver.update(Telephony.Sms.CONTENT_URI, v, "${Telephony.Sms.THREAD_ID} = ? AND ${Telephony.Sms.READ} = 0", arrayOf(threadId.toString()))
            } else {
                ctx.contentResolver.update(Telephony.Sms.CONTENT_URI, v, "${Telephony.Sms.ADDRESS} = ? AND ${Telephony.Sms.READ} = 0", arrayOf(address))
            }
        } catch (e: Exception) {
            // Not the SMS app: Android does not let this app change message state.
        }
        try {
            ctx.getSystemService(NotificationManager::class.java)?.cancel(SmsIntake.notificationId(address))
        } catch (e: Exception) {
        }
    }

    /** Marks everything from one sender as read (the notification's "Mark as read" button). */
    fun markReadByAddress(ctx: Context, address: String) = markRead(ctx, 0L, address)

    fun unreadTotal(ctx: Context): Int = try {
        ctx.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI, arrayOf(Telephony.Sms._ID),
            "${Telephony.Sms.READ} = 0", null, null,
        )?.use { it.count } ?: 0
    } catch (e: Exception) {
        0
    }

    /** Sends a text message and records it in the phone's Sent messages. The result only says whether sending was STARTED;
     *  whether the network took it shows on the message itself (sending / sent / failed) a moment later. */
    fun send(ctx: Context, toRaw: String, body: String): SendResult {
        val to = PhoneNumber.clean(toRaw) ?: return SendResult.Failed("That is not a phone number that messages can be sent to.")
        val text = body.trim()
        if (text.isEmpty()) return SendResult.Failed("Type a message first.")
        if (!DefaultSms.isDefault(ctx)) return SendResult.Failed("Turn on SMS app mode on the Dashboard tab first. Android only lets the phone's SMS app send and save messages.")
        if (!canSend(ctx)) return SendResult.Failed("Allow PayTrace to send messages first.")

        val threadId = try { Telephony.Threads.getOrCreateThreadId(ctx, to) } catch (e: Exception) { 0L }
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put(Telephony.Sms.ADDRESS, to)
            put(Telephony.Sms.BODY, text)
            put(Telephony.Sms.DATE, now)
            put(Telephony.Sms.READ, 1)
            put(Telephony.Sms.SEEN, 1)
            put(Telephony.Sms.TYPE, SmsRow.TYPE_OUTBOX)
            put(Telephony.Sms.STATUS, Telephony.Sms.STATUS_PENDING)
            if (threadId > 0) put(Telephony.Sms.THREAD_ID, threadId)
        }
        val uri: Uri = try {
            ctx.contentResolver.insert(Telephony.Sms.CONTENT_URI, values)
        } catch (e: Exception) {
            null
        } ?: return SendResult.Failed("The phone would not save the message, so it was not sent.")

        return try {
            val sm = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java)
            else @Suppress("DEPRECATION") SmsManager.getDefault()
            val parts = sm.divideMessage(text)
            val id = ContentUris.parseId(uri)
            val sent = ArrayList<PendingIntent>()
            val delivered = ArrayList<PendingIntent>()
            for (i in parts.indices) {
                sent.add(report(ctx, SmsSentReceiver::class.java, uri, (id * 16 + i).toInt()))
                delivered.add(report(ctx, SmsDeliveredReceiver::class.java, uri, (id * 16 + i).toInt() + 1_000_000))
            }
            if (parts.size == 1) sm.sendTextMessage(to, null, text, sent[0], delivered[0])
            else sm.sendMultipartTextMessage(to, null, parts, sent, delivered)
            SendResult.Ok
        } catch (e: Exception) {
            setType(ctx, uri, SmsRow.TYPE_FAILED)
            SendResult.Failed("Android refused to send it: " + (e.message ?: e.javaClass.simpleName))
        }
    }

    private fun report(ctx: Context, receiver: Class<*>, uri: Uri, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            ctx, code, Intent(ctx, receiver).setData(uri),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun setType(ctx: Context, uri: Uri, type: Int) {
        try { ctx.contentResolver.update(uri, ContentValues().apply { put(Telephony.Sms.TYPE, type) }, null, null) } catch (e: Exception) { }
    }

    fun setStatus(ctx: Context, uri: Uri, status: Int) {
        try { ctx.contentResolver.update(uri, ContentValues().apply { put(Telephony.Sms.STATUS, status) }, null, null) } catch (e: Exception) { }
    }
}

/** Android tells the app whether the network accepted the message. */
class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val uri = intent.data ?: return
        if (resultCode == Activity.RESULT_OK) SmsStore.setType(context, uri, SmsRow.TYPE_SENT)
        else SmsStore.setType(context, uri, SmsRow.TYPE_FAILED)
    }
}

/** ...and later whether it reached the other phone. */
class SmsDeliveredReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val uri = intent.data ?: return
        SmsStore.setStatus(context, uri, if (resultCode == Activity.RESULT_OK) SmsRow.STATUS_COMPLETE else SmsRow.STATUS_FAILED)
    }
}

/** The notification's "Mark as read" button. */
class MarkReadReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val address = intent.getStringExtra("address") ?: return
        SmsStore.markReadByAddress(context, address)
    }
}

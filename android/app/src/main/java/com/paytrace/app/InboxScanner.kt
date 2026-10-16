package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat

/** Safety net for the live SMS listener. If the phone was off, or Android froze the app, a payment message can
 *  arrive with nobody listening. It is still in the phone's inbox, so this reads the inbox and picks up anything
 *  from bKash, Nagad, Rocket or Upay that was never stored. The server ignores anything it already has. */
object InboxScanner {
    /** How many missed messages were picked up. -1 if the inbox could not be read (the next scan tries again). */
    fun run(ctx: Context): Int {
        val app = ctx.applicationContext
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) return -1
        val settings = AppSettings(app)
        val now = System.currentTimeMillis()
        val since = CatchUp.since(now, settings.inboxResumeFrom)

        val rows = try {
            read(app, since)
        } catch (e: Exception) {
            return -1 // leave the resume point alone, so this window is looked at again next time
        }

        val db = Db.get(app)
        // Messages already stored (live, possibly under a differently written sender name) do not count against the batch.
        val picked = CatchUp.select(rows, since, Providers::fromSender, settings::providerEnabled) { db.hasMessage(it.provider, it.body) }
        var added = 0
        for (c in picked.items) {
            val id = db.insertIfNew(c.provider, c.sender, c.body, Providers.quick(c.body), c.date)
            if (id > 0) {
                SendWorker.enqueue(app, id, 0)
                added++
            }
        }
        settings.inboxResumeFrom = CatchUp.resumeFrom(now, picked)
        settings.inboxCheckedAt = now
        if (added > 0) settings.recoveredTotal += added
        return added
    }

    private fun read(ctx: Context, since: Long): List<CatchUp.InboxRow> {
        val out = ArrayList<CatchUp.InboxRow>()
        ctx.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} >= ?",
            arrayOf(since.toString()),
            "${Telephony.Sms.DATE} ASC",
        )?.use { c ->
            val a = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val b = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val d = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
            while (c.moveToNext()) out.add(CatchUp.InboxRow(c.getString(a), c.getString(b), c.getLong(d)))
        }
        return out
    }
}

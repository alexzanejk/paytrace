package com.paytrace.app

/** One text message as stored in the phone's own message database. Plain data so the logic below can be unit tested. */
data class SmsRow(
    val id: Long,
    val threadId: Long,
    val address: String,
    val body: String,
    val date: Long,
    val type: Int, // 1 received, 2 sent, 3 draft, 4 sending, 5 failed, 6 queued (Android's own numbers)
    val read: Boolean,
    val status: Int, // delivery report: -1 none, 0 delivered, 32 pending, 64 failed
) {
    val incoming get() = type == TYPE_INBOX
    val failed get() = type == TYPE_FAILED || status == STATUS_FAILED
    val sending get() = type == TYPE_OUTBOX || type == TYPE_QUEUED

    companion object {
        const val TYPE_INBOX = 1
        const val TYPE_SENT = 2
        const val TYPE_OUTBOX = 4
        const val TYPE_FAILED = 5
        const val TYPE_QUEUED = 6
        const val STATUS_COMPLETE = 0
        const val STATUS_FAILED = 64
    }
}

/** One conversation in the list: the newest message, how many are unseen, how many in total. */
data class ThreadSummary(
    val threadId: Long,
    val address: String,
    val lastBody: String,
    val lastDate: Long,
    val unread: Int,
    val count: Int,
)

object ThreadGrouping {
    /** Groups messages into conversations, newest conversation first. A conversation is the phone's own thread id; messages
     *  without one (rare) are grouped by the number they came from. */
    fun group(rows: List<SmsRow>): List<ThreadSummary> =
        rows.groupBy { if (it.threadId > 0) "t${it.threadId}" else "a${it.address}" }
            .values
            .map { msgs ->
                val last = msgs.maxByOrNull { it.date }!!
                ThreadSummary(
                    threadId = last.threadId,
                    address = last.address,
                    lastBody = last.body,
                    lastDate = last.date,
                    unread = msgs.count { it.incoming && !it.read },
                    count = msgs.size,
                )
            }
            .sortedByDescending { it.lastDate }
}

object PhoneNumber {
    /** A number someone typed, tidied for sending: spaces, dashes and brackets removed, a leading + kept. Null if it cannot be a
     *  phone number (letters, too short, too long). Names like "bKash" are sender names: they cannot be replied to. */
    fun clean(raw: String?): String? {
        val t = (raw ?: "").trim()
        if (t.isEmpty()) return null
        val plus = t.startsWith("+")
        val digits = t.filter { it.isDigit() }
        val stripped = t.replace(Regex("[\\s\\-().+]"), "")
        if (stripped.any { !it.isDigit() }) return null
        if (digits.length < 3 || digits.length > 15) return null
        return (if (plus) "+" else "") + digits
    }

    fun canReplyTo(address: String?): Boolean = clean(address) != null
}

/** How a message is shown: the unseen count badge, and a short preview. */
object MessageText {
    fun preview(body: String, max: Int = 80): String {
        val flat = body.replace(Regex("\\s+"), " ").trim()
        return if (flat.length <= max) flat else flat.take(max - 1) + "…"
    }

    /** SMS limits: 160 plain characters per part (70 if the text has Bangla or other non-Latin letters), 153/67 when split. */
    fun parts(body: String): Int {
        if (body.isEmpty()) return 0
        val unicode = body.any { it.code > 127 }
        val single = if (unicode) 70 else 160
        val multi = if (unicode) 67 else 153
        return if (body.length <= single) 1 else (body.length + multi - 1) / multi
    }
}

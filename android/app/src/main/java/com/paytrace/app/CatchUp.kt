package com.paytrace.app

/** Decides which old SMS to pick up again after the phone was off or the app was frozen, so a payment
 *  message that arrived while nobody was listening is not lost. No Android code in here on purpose: it can be
 *  unit tested on an ordinary computer (see CatchUpTest). */
object CatchUp {
    /** First ever scan: how far back to look. Enough to cover "the app was not running yet this morning". */
    const val FIRST_LOOKBACK_MS = 24L * 60 * 60 * 1000

    /** However long the phone was off, never look back further than this. */
    const val MAX_LOOKBACK_MS = 7L * 24 * 60 * 60 * 1000

    /** A finished scan resumes this much before it ended, so a clock that is slightly off cannot hide a message. */
    const val OVERLAP_MS = 60L * 60 * 1000

    /** One scan handles at most this many NEW messages. The rest are picked up by the next scan, nothing is skipped. */
    const val MAX_PER_SCAN = 200

    data class InboxRow(val address: String?, val body: String?, val date: Long)
    data class Candidate(val provider: String, val sender: String, val body: String, val date: Long)

    /** items are new messages, oldest first. truncated = there were more than MAX_PER_SCAN of them. */
    data class Selection(val items: List<Candidate>, val truncated: Boolean)

    /** The earliest message time to look at. resumeFrom is where the previous scan said to continue (null = never scanned). */
    fun since(now: Long, resumeFrom: Long?): Long =
        maxOf(resumeFrom ?: (now - FIRST_LOOKBACK_MS), now - MAX_LOOKBACK_MS).coerceAtMost(now)

    /** Where the next scan should continue from.
     *  Finished: a little before now. Batch full: exactly at the last message handled, so the next scan carries on
     *  from there (and, because stored messages do not count against a batch, always makes progress). */
    fun resumeFrom(now: Long, picked: Selection): Long =
        if (picked.truncated) picked.items.last().date else now - OVERLAP_MS

    /** have = "this message is already stored". Those are left out before the batch limit is applied. */
    fun select(
        rows: List<InboxRow>,
        since: Long,
        providerOf: (String?) -> String?,
        enabled: (String) -> Boolean,
        have: (Candidate) -> Boolean = { false },
    ): Selection {
        val fresh = rows.asSequence()
            .filter { it.date >= since }
            .mapNotNull { r ->
                val sender = r.address?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                val body = r.body?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val provider = providerOf(sender) ?: return@mapNotNull null
                if (!enabled(provider)) return@mapNotNull null
                Candidate(provider, sender, body, r.date)
            }
            // Oldest first: the server checks each balance against the one before it.
            .sortedBy { it.date }
            .filterNot(have)
            .toList()
        return Selection(fresh.take(MAX_PER_SCAN), fresh.size > MAX_PER_SCAN)
    }
}

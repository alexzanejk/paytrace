package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatchUpTest {
    private val now = 1_800_000_000_000L
    private val hour = 60L * 60 * 1000
    private val day = 24 * hour

    private fun pick(
        rows: List<CatchUp.InboxRow>,
        since: Long = now - day,
        enabled: (String) -> Boolean = { true },
        have: (CatchUp.Candidate) -> Boolean = { false },
    ) = CatchUp.select(rows, since, Providers::fromSender, enabled, have)

    private fun bkash(body: String, at: Long) = CatchUp.InboxRow("bKash", body, at)

    // ---- the time window ----

    @Test fun firstScanLooksBackOneDay() =
        assertEquals(now - day, CatchUp.since(now, null))

    @Test fun laterScansStartWhereThePreviousOneSaidToContinue() =
        assertEquals(now - 2 * hour, CatchUp.since(now, now - 2 * hour))

    @Test fun aPhoneOffForAMonthOnlyLooksBackAWeek() =
        assertEquals(now - 7 * day, CatchUp.since(now, now - 30 * day))

    @Test fun aClockThatRanAheadNeverLooksIntoTheFuture() =
        assertTrue(CatchUp.since(now, now + 10 * day) <= now)

    @Test fun aFinishedScanResumesAnHourBeforeItEnded() =
        assertEquals(now - hour, CatchUp.resumeFrom(now, CatchUp.Selection(emptyList(), false)))

    // ---- which messages are picked ----

    @Test fun onlyProviderSendersAreKept() {
        val rows = listOf(
            bkash("Cash Out Tk 500", now - hour),
            CatchUp.InboxRow("01712345678", "You have received payment Tk 500 from 01811111111 TrxID FAKE123456", now - hour),
            CatchUp.InboxRow("GP Offer", "Buy 10GB", now - hour),
            CatchUp.InboxRow("NAGAD", "Cash Out Received", now - hour),
        )
        assertEquals(listOf("BKASH", "NAGAD"), pick(rows).items.map { it.provider })
    }

    @Test fun aLookAlikeFromANormalNumberIsNeverPickedUp() {
        val fake = CatchUp.InboxRow("01712345678", "Cash Out Tk 500.00 from 0181XXXX536 successful. TrxID DIH6LCWPME", now - hour)
        assertTrue(pick(listOf(fake)).items.isEmpty())
    }

    @Test fun senderSpellingDoesNotMatter() {
        val rows = listOf("bKash", "BKASH", " bkash ", "16216", "Upay").map { CatchUp.InboxRow(it, "x", now - hour) }
        assertEquals(listOf("BKASH", "BKASH", "BKASH", "ROCKET", "UPAY"), pick(rows).items.map { it.provider })
    }

    @Test fun aSwitchedOffProviderIsLeftAlone() {
        val rows = listOf(bkash("x", now - hour), CatchUp.InboxRow("NAGAD", "y", now - hour))
        assertEquals(listOf("NAGAD"), pick(rows, enabled = { it != "BKASH" }).items.map { it.provider })
    }

    @Test fun emptyOrMissingFieldsAreSkipped() {
        val rows = listOf(
            CatchUp.InboxRow(null, "x", now - hour),
            CatchUp.InboxRow("", "x", now - hour),
            CatchUp.InboxRow("bKash", null, now - hour),
            CatchUp.InboxRow("bKash", "   ", now - hour),
        )
        assertTrue(pick(rows).items.isEmpty())
    }

    @Test fun messagesBeforeTheWindowAreIgnored() {
        val rows = listOf(bkash("old", now - 3 * day), bkash("new", now - hour))
        assertEquals(listOf("new"), pick(rows).items.map { it.body })
    }

    @Test fun oldestComesFirstSoTheBalanceChainSeesThemInOrder() {
        val rows = listOf(bkash("third", now - hour), bkash("first", now - 5 * hour), bkash("second", now - 3 * hour))
        assertEquals(listOf("first", "second", "third"), pick(rows).items.map { it.body })
    }

    @Test fun theBodyIsKeptExactlyAsReceived() {
        val body = "Cash Out Received.\nAmount: Tk 500.00\nTxnID: 75WEZVOJ"
        assertEquals(body, pick(listOf(CatchUp.InboxRow("NAGAD", body, now - hour))).items.single().body)
    }

    // ---- messages we already have ----

    @Test fun messagesAlreadyStoredAreNotPickedUpAgain() {
        val rows = listOf(bkash("have", now - 2 * hour), bkash("missed", now - hour))
        assertEquals(listOf("missed"), pick(rows, have = { it.body == "have" }).items.map { it.body })
    }

    @Test fun storedMessagesDoNotUseUpTheBatch() {
        val rows = (1..250).map { bkash("m$it", now - hour + it) }
        // the oldest 100 are already stored: the 150 that remain fit in one batch
        val sel = pick(rows, have = { it.body.removePrefix("m").toInt() <= 100 })
        assertEquals(150, sel.items.size)
        assertFalse(sel.truncated)
    }

    // ---- a big backlog is handled in batches, never skipped ----

    @Test fun aBacklogLargerThanOneBatchIsFlaggedAndKeepsTheOldestFirst() {
        val rows = (1..250).map { bkash("m$it", now - hour + it) }
        val sel = pick(rows)
        assertEquals(CatchUp.MAX_PER_SCAN, sel.items.size)
        assertTrue(sel.truncated)
        assertEquals("m1", sel.items.first().body)
        assertEquals("m200", sel.items.last().body)
    }

    @Test fun anExactlyFullBatchIsNotFlaggedAsTruncated() {
        val rows = (1..CatchUp.MAX_PER_SCAN).map { bkash("m$it", now - hour + it) }
        assertFalse(pick(rows).truncated)
    }

    /** The case that matters: more than one batch, all inside a single hour. A scan that resumed an hour BEFORE where
     *  it stopped would pick the same first 200 forever. Simulate repeated scans, storing what each one picks up. */
    @Test fun repeatedScansOverADenseBacklogEventuallyPickUpEverything() {
        val rows = (1..450).map { bkash("m$it", now - hour + it) }
        val stored = mutableSetOf<String>()
        var resume: Long? = null
        var scans = 0
        do {
            val sel = pick(rows, since = CatchUp.since(now, resume), have = { it.body in stored })
            sel.items.forEach { stored += it.body }
            resume = CatchUp.resumeFrom(now, sel)
            scans++
        } while (sel.truncated && scans < 10)
        assertEquals(450, stored.size)
        assertEquals(3, scans) // 200 + 200 + 50
    }

    @Test fun aFinishedScanAfterABacklogFindsNothingNew() {
        val rows = (1..250).map { bkash("m$it", now - hour + it) }
        val stored = rows.map { it.body!! }.toSet()
        assertTrue(pick(rows, have = { it.body in stored }).items.isEmpty())
    }
}

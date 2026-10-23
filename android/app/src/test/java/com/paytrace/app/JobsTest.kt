package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JobsTest {
    // The shape the server really sends (taken from the live database test).
    private val sample = """
        {"success":true,"jobs":[
          {"provider":"nagad","agent":"Karim","urgency":"critical","balance":15000.00,"balance_at":"2026-10-23T12:00:00+00:00",
           "threshold":10000.00,"wallet":"0x71C7656EC7ab88b098defB751B7401B5f6d8976F","network":"BNB Smart Chain (BEP20)","instruction":"Karim, urgent: move it today"},
          {"provider":"bkash","agent":"Counter 1","urgency":"normal","balance":12000,"threshold":10000,"wallet":"01711111111","instruction":"Do it"}
        ]}
    """.trimIndent()

    @Test fun readsTheJobs() {
        val jobs = JobsParser.parse(sample)
        assertNotNull(jobs)
        assertEquals(2, jobs!!.size)
        assertEquals("nagad", jobs[0].provider)
        assertEquals("Karim", jobs[0].agent)
        assertEquals("critical", jobs[0].urgency)
        assertEquals(15000.0, jobs[0].balance, 0.001)
        assertEquals("0x71C7656EC7ab88b098defB751B7401B5f6d8976F", jobs[0].wallet)
        assertEquals("BNB Smart Chain (BEP20)", jobs[0].network)
        assertEquals("", jobs[1].network)
        assertEquals("Karim, urgent: move it today", jobs[0].instruction)
        assertEquals("Counter 1", jobs[1].agent)
        assertEquals("", jobs[1].balanceAt)
    }

    @Test fun anUnknownOrMissingUrgencyIsNormal() {
        val jobs = JobsParser.parse("""{"success":true,"jobs":[{"provider":"bkash","wallet":"0171","instruction":"x"},{"provider":"nagad","urgency":"extreme","wallet":"0181","instruction":"y"}]}""")
        assertEquals("normal", jobs!![0].urgency)
        assertEquals("normal", jobs[1].urgency)
    }

    @Test fun noJobsIsAnEmptyList() {
        assertEquals(emptyList<Job>(), JobsParser.parse("""{"success":true,"jobs":[]}"""))
        assertEquals(emptyList<Job>(), JobsParser.parse("""{"success":true}"""))
    }

    @Test fun aJobWithoutAWalletIsDropped() {
        val jobs = JobsParser.parse("""{"success":true,"jobs":[{"provider":"bkash","balance":1,"wallet":"","instruction":"x"},{"provider":"","wallet":"0171","instruction":"y"}]}""")
        assertEquals(0, jobs!!.size)
    }

    @Test fun anErrorOrGarbageKeepsWhatWasShown() {
        assertNull(JobsParser.parse("""{"success":false,"message":"could not load jobs"}"""))
        assertNull(JobsParser.parse("not json"))
        assertNull(JobsParser.parse(""))
    }

    @Test fun theAmountReadsAsPlainMoney() {
        assertTrue(EarningsFormat.money(12000.0) == "Tk 12,000.00")
    }

    // ---- sent-money check ----
    @Test fun readsTheSubmittedSends() {
        val text = """{"success":true,"jobs":[],"transfers":[
          {"id":"a1","provider":"nagad","amount":10000.00,"charge":50.00,"status":"mismatch","attempts":1,"submitted_at":"2026-10-23T12:00:00+00:00"},
          {"id":"a2","provider":"bkash","amount":5000,"charge":0,"status":"verified","attempts":1},
          {"provider":"bkash","status":"verified"}]}"""
        val t = JobsParser.parseTransfers(text)
        assertEquals(2, t.size)
        assertEquals("a1", t[0].id)
        assertEquals(10000.0, t[0].amount, 0.001)
        assertEquals(50.0, t[0].charge, 0.001)
        assertTrue(t[0].canFix)
        assertEquals(false, t[1].canFix)
    }

    @Test fun aSecondMissCannotBeFixedAgain() {
        val t = JobsParser.parseTransfers("""{"success":true,"transfers":[{"id":"a","provider":"nagad","status":"mismatch","attempts":2}]}""")
        assertEquals(false, t[0].canFix)
    }

    @Test fun anOlderServerOrBadReplyHasNoSends() {
        assertEquals(emptyList<Transfer>(), JobsParser.parseTransfers("""{"success":true,"jobs":[]}"""))
        assertEquals(emptyList<Transfer>(), JobsParser.parseTransfers("not json"))
        assertEquals(emptyList<Transfer>(), JobsParser.parseTransfers("""{"success":false}"""))
    }

    @Test fun understandsTheServersAnswerToASend() {
        val ok = JobsParser.parseSend("""{"success":true,"ok":true,"id":"x"}""")
        assertTrue(ok.ok)
        assertEquals("", ok.message)
        val wait = JobsParser.parseSend("""{"success":true,"ok":false,"error":"already_waiting"}""")
        assertEquals(false, wait.ok)
        assertTrue(wait.message.contains("still being checked"))
        assertTrue(JobsParser.parseSend("""{"success":true,"ok":false,"error":"too_much"}""").message.contains("more than"))
        assertTrue(JobsParser.parseSend(null).message.contains("Could not reach"))
        assertTrue(JobsParser.parseSend("junk").message.contains("Could not save"))
        val fixed = JobsParser.parseSend("""{"success":true,"ok":true,"status":"verified"}""")
        assertEquals("verified", fixed.status)
    }

    @Test fun readsWhatThePartnerTypes() {
        assertEquals(10000.0, MoneyInput.parse("10000")!!, 0.0)
        assertEquals(10000.0, MoneyInput.parse(" 10,000 ")!!, 0.0)
        assertEquals(50.5, MoneyInput.parse("50.5")!!, 0.0)
        assertEquals(12.25, MoneyInput.parse("12.25")!!, 0.0)
        assertEquals(10000.0, MoneyInput.parse("\u09E7\u09E6\u09E6\u09E6\u09E6")!!, 0.0)
        assertNull(MoneyInput.parse(""))
        assertNull(MoneyInput.parse("abc"))
        assertNull(MoneyInput.parse("-5"))
        assertNull(MoneyInput.parse("1.234"))
        assertNull(MoneyInput.parse("12.5.1"))
        assertNull(MoneyInput.parse("1e5"))
    }
}

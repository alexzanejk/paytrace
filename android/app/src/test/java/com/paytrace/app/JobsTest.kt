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
}

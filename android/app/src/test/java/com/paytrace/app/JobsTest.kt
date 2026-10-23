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
          {"provider":"bkash","balance":12000.00,"balance_at":"2026-10-23T12:00:00+00:00","threshold":10000.00,
           "wallet":"01711111111","instruction":"Send Tk 12,000.00 from bKash now"},
          {"provider":"nagad","balance":10500,"threshold":10000,"wallet":"01822222222","instruction":"Do it"}
        ]}
    """.trimIndent()

    @Test fun readsTheJobs() {
        val jobs = JobsParser.parse(sample)
        assertNotNull(jobs)
        assertEquals(2, jobs!!.size)
        assertEquals("bkash", jobs[0].provider)
        assertEquals(12000.0, jobs[0].balance, 0.001)
        assertEquals("01711111111", jobs[0].wallet)
        assertEquals("Send Tk 12,000.00 from bKash now", jobs[0].instruction)
        assertEquals("", jobs[1].balanceAt)
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

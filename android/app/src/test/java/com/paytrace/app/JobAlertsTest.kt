package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class JobAlertsTest {
    private val karim = JobBrief("nagad", "Karim", "critical", 15000.0, "2026-10-23T12:00:00+00:00")
    private val counter = JobBrief("bkash", "Counter 1", "urgent", 12000.0, "2026-10-23T12:05:00+00:00")
    private val t0 = 1_000_000_000L

    @Test fun aNewJobRingsAtOnce() {
        val d = JobAlertPolicy.decide(listOf(karim), emptyMap(), t0)
        assertEquals(listOf(karim), d.ring)
        assertEquals(t0, d.state[JobAlertPolicy.key(karim)])
    }

    @Test fun aJobThatAlreadyRangStaysQuietUntilTenMinutesPass() {
        val first = JobAlertPolicy.decide(listOf(karim), emptyMap(), t0)
        val soon = JobAlertPolicy.decide(listOf(karim), first.state, t0 + 9 * 60_000L)
        assertTrue(soon.ring.isEmpty())
        assertEquals(t0, soon.state[JobAlertPolicy.key(karim)]) // the clock keeps running from the last ring
        val later = JobAlertPolicy.decide(listOf(karim), soon.state, t0 + 10 * 60_000L)
        assertEquals(listOf(karim), later.ring)
        assertEquals(t0 + 10 * 60_000L, later.state[JobAlertPolicy.key(karim)])
    }

    @Test fun onlyTheNewJobRingsWhenAnotherIsAlreadyKnown() {
        val first = JobAlertPolicy.decide(listOf(karim), emptyMap(), t0)
        val d = JobAlertPolicy.decide(listOf(karim, counter), first.state, t0 + 60_000L)
        assertEquals(listOf(counter), d.ring)
    }

    @Test fun aFinishedJobIsForgottenSoItRingsAgainWhenItComesBackWithANewerBalance() {
        val first = JobAlertPolicy.decide(listOf(karim), emptyMap(), t0)
        val gone = JobAlertPolicy.decide(emptyList(), first.state, t0 + 60_000L)
        assertTrue(gone.state.isEmpty())
        val back = karim.copy(balanceAt = "2026-10-23T12:30:00+00:00")
        val d = JobAlertPolicy.decide(listOf(back), gone.state, t0 + 120_000L)
        assertEquals(listOf(back), d.ring)
    }

    @Test fun theStateSurvivesBeingSavedAndReadBack() {
        val state = mapOf("nagad|2026-10-23T12:00:00+00:00" to t0, "bkash|x" to 5L)
        assertEquals(state, JobAlertPolicy.decode(JobAlertPolicy.encode(state)))
        assertEquals(emptyMap<String, Long>(), JobAlertPolicy.decode(""))
        assertEquals(emptyMap<String, Long>(), JobAlertPolicy.decode("not json"))
        assertEquals(emptyMap<String, Long>(), JobAlertPolicy.decode(null))
    }

    @Test fun readsTheHeartbeatReply() {
        val reply = """{"success":true,"message":"heartbeat ok","device_status":"approved","jobs":[
            {"provider":"nagad","agent":"Karim","urgency":"critical","balance":15000.0,"balance_at":"2026-10-23T12:00:00+00:00"},
            {"provider":"bkash","agent":"Counter 1","urgency":"extreme","balance":12000}]}"""
        val jobs = JobAlertPolicy.parseBrief(reply)
        assertNotNull(jobs)
        assertEquals(2, jobs!!.size)
        assertEquals(karim, jobs[0])
        assertEquals("normal", jobs[1].urgency) // an unknown level is treated as normal
        assertEquals("", jobs[1].balanceAt)
    }

    @Test fun noJobsIsAnEmptyListButNoJobListMeansChangeNothing() {
        assertEquals(emptyList<JobBrief>(), JobAlertPolicy.parseBrief("""{"success":true,"jobs":[]}"""))
        assertNull(JobAlertPolicy.parseBrief("""{"success":true,"message":"heartbeat ok"}"""))
        assertNull(JobAlertPolicy.parseBrief("""{"success":false,"jobs":[]}"""))
        assertNull(JobAlertPolicy.parseBrief("not json"))
        assertNull(JobAlertPolicy.parseBrief(null))
        assertNull(JobAlertPolicy.parseBrief(""))
    }

    @Test fun theNotificationNamesTheAgentsAndTheMostUrgentLevel() {
        assertEquals(listOf("Karim · Nagad · Tk 15,000.00", "Counter 1 · bKash · Tk 12,000.00"), JobAlertPolicy.lines(listOf(karim, counter)))
        assertEquals("critical", JobAlertPolicy.topUrgency(listOf(counter, karim)))
        assertEquals("urgent", JobAlertPolicy.topUrgency(listOf(counter)))
        assertEquals("normal", JobAlertPolicy.topUrgency(emptyList()))
        assertEquals(listOf("bKash · Tk 1.00"), JobAlertPolicy.lines(listOf(JobBrief("bkash", "", "normal", 1.0, ""))))
    }

    @Test fun aCashInJobRingsSeparatelyFromASendJobOfTheSameWallet() {
        val send = JobBrief("bkash", "A", "normal", 9000.0, "2026-10-26T10:00:00+00:00")
        val cash = JobBrief("bkash", "A", "urgent", 9000.0, "2026-10-26T10:00:00+00:00", kind = "cashin")
        assertTrue(JobAlertPolicy.key(send) != JobAlertPolicy.key(cash))
        val d = JobAlertPolicy.decide(listOf(send, cash), emptyMap(), 1000L)
        assertEquals(2, d.ring.size)
    }
}

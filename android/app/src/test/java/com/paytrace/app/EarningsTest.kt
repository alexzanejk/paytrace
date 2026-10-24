package com.paytrace.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EarningsTest {
    // The shape the server really sends (taken from the live database test): bKash Cash Out 4,000 at 5% and Nagad Cash Out 2,000 at 5% today.
    private val sample = """
        {"success":true,"device_status":"approved","enabled":true,"name":"Counter 1","day":"2026-10-23",
         "today":{"total":6000.00,"commission":300.00},
         "today_detail":[{"kind":"cash_out","rate":5.00,"total":4000.00,"provider":"bkash","commission":200.00},
                         {"kind":"cash_out","rate":5.00,"total":2000.00,"provider":"nagad","commission":100.00}],
         "month":{"total":21000.00,"commission":850.00},
         "days":[{"day":"2026-10-23","total":6000.00,"commission":300.00},{"day":"2026-10-22","total":0,"commission":0}],
         "rates":[{"kind":"cash_out","rate":5.00,"provider":"bkash"},{"kind":"send_money","rate":3.5,"provider":"bkash"}],
         "earned":850.00,"paid":300.00,"owed":550.00}
    """.trimIndent()

    @Test fun readsTheServersAnswer() {
        val e = EarningsParser.parse(sample)
        assertNotNull(e)
        e!!
        assertTrue(e.enabled)
        assertEquals("Counter 1", e.name)
        assertEquals(300.0, e.today.commission, 0.001)
        assertEquals(6000.0, e.today.total, 0.001)
        assertEquals(2, e.todayDetail.size)
        assertEquals("bkash", e.todayDetail[0].provider)
        assertEquals(850.0, e.month.commission, 0.001)
        assertEquals(2, e.days.size)
        assertEquals("2026-10-22", e.days[1].day)
        assertEquals(0.0, e.days[1].total, 0.001)
        assertEquals(2, e.rates.size)
        assertEquals(3.5, e.rates[1].rate, 0.001)
        assertEquals(550.0, e.owed, 0.001)
    }

    @Test fun whenTheOwnerHasNotSwitchedItOnTheCardStaysHidden() {
        val e = EarningsParser.parse("""{"success":true,"enabled":false}""")
        assertNotNull(e)
        assertFalse(e!!.enabled)
    }

    @Test fun aFailedOrBrokenAnswerIsIgnoredSoTheLastNumbersStay() {
        assertNull(EarningsParser.parse("""{"success":false,"message":"could not load earnings"}"""))
        assertNull(EarningsParser.parse("not json at all"))
        assertNull(EarningsParser.parse(""))
    }

    @Test fun aMissingPartDoesNotCrash() {
        val e = EarningsParser.parse("""{"success":true,"enabled":true}""")
        assertNotNull(e)
        assertTrue(e!!.days.isEmpty())
        assertEquals(0.0, e.today.commission, 0.001)
    }

    @Test fun moneyIsGroupedWithTwoDecimals() {
        assertEquals("Tk 1,234.50", EarningsFormat.money(1234.5))
        assertEquals("Tk 0.00", EarningsFormat.money(0.0))
        assertEquals("Tk 21,000.00", EarningsFormat.money(21000.0))
    }

    @Test fun percentsDropNeedlessZeros() {
        assertEquals("5%", EarningsFormat.pct(5.0))
        assertEquals("4.5%", EarningsFormat.pct(4.5))
        assertEquals("12.25%", EarningsFormat.pct(12.25))
    }

    @Test fun namesAreFriendly() {
        assertEquals("bKash", EarningsFormat.provider("bkash"))
        assertEquals("Upay", EarningsFormat.provider("upay"))
        assertEquals("Cash Out", EarningsFormat.kind("cash_out"))
        assertEquals("Send Money", EarningsFormat.kind("send_money"))
    }

    @Test fun daysReadLikeADiary() {
        assertEquals("Fri 23 Oct", EarningsFormat.dayLabel("2026-10-23"))
        assertEquals("not a date", EarningsFormat.dayLabel("not a date"))
    }

    @Test fun linesExplainTheMaths() {
        assertEquals("Tk 4,000.00 at 5% = Tk 200.00", EarningsFormat.line(EarnLine("bkash", "cash_out", 4000.0, 5.0, 200.0)))
        assertEquals("bKash Send Money 3.5%", EarningsFormat.rateLine(EarnRate("bkash", "send_money", 3.5)))
    }

    @Test fun readsTheMonthAndTheLastThreeDaysOfPayments() {
        val text = """{"success":true,"enabled":true,"day":"2026-10-24","owed":80.00,"earned":300.00,"paid":220.00,
          "month_start":"2026-10-01","month_end":"2026-10-31","paid_month":220.00,
          "month_days":[{"day":"2026-10-31","total":0,"commission":0},{"day":"2026-10-24","total":4000,"commission":200},{"day":"2026-10-01","total":0,"commission":0}],
          "recent_paid":[{"day":"2026-10-24","amount":100.00,"note":"today pay"},{"day":"2026-10-22","amount":50.00,"note":null}]}"""
        val e = EarningsParser.parse(text)!!
        assertEquals("2026-10-01", e.monthStart)
        assertEquals("2026-10-31", e.monthEnd)
        assertEquals(3, e.monthDays.size)
        assertEquals(200.0, e.monthDays[1].commission, 0.001)
        assertEquals(2, e.recentPaid.size)
        assertEquals(100.0, e.recentPaid[0].amount, 0.001)
        assertEquals("today pay", e.recentPaid[0].note)
        assertEquals(220.0, e.paidMonth, 0.001)
    }

    @Test fun anOlderServerWithoutTheNewPartsStillWorks() {
        val e = EarningsParser.parse(sample)!!
        assertEquals(emptyList<EarnPaid>(), e.recentPaid)
        assertEquals(emptyList<EarnDay>(), e.monthDays)
        assertEquals("", e.monthStart)
    }

    @Test fun theMonthReadsAsARange() {
        assertEquals("1 Oct \u2013 31 Oct", EarningsFormat.rangeLabel("2026-10-01", "2026-10-31"))
        assertEquals("", EarningsFormat.rangeLabel("", ""))
    }

    @Test fun timesReadInBangladeshTime() {
        // 09:05 UTC is 3:05 PM in Dhaka (UTC+6).
        assertEquals("Fri 23 Oct, 3:05 PM", EarningsFormat.whenText("2026-10-23T09:05:00+00:00"))
        // 18:30 UTC is 12:30 AM the next day.
        assertEquals("Sat 24 Oct, 12:30 AM", EarningsFormat.whenText("2026-10-23T18:30:00+00:00"))
        assertEquals("", EarningsFormat.whenText(""))
        assertEquals("", EarningsFormat.whenText("not a time"))
    }
}

package com.paytrace.app

import com.paytrace.app.NagadRead.Screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZonedDateTime

/** Built from the owner's screen video of the Nagad agent app, 2026-11-11 (Bangla screens). */
class NagadAppTest {
    private val today = LocalDate.of(2026, 11, 11)
    private fun at(y: Int, mo: Int, d: Int, h: Int, mi: Int) = ZonedDateTime.of(y, mo, d, h, mi, 0, 0, NagadRead.DHAKA).toInstant().toEpochMilli()

    @Test fun theAgentAppIsPickedNotTheCustomerApp() {
        assertEquals("com.konasl.nagad.agent", NagadRead.pickPackage(listOf("com.konasl.nagad" to "Nagad", "com.konasl.nagad.agent" to "Uddokta")))
        assertEquals("com.x.uddokta", NagadRead.pickPackage(listOf("com.x.uddokta" to "Uddokta", "com.whatsapp" to "WhatsApp")))
        // Only the customer app on the phone: nothing to drive.
        assertNull(NagadRead.pickPackage(listOf("com.konasl.nagad" to "Nagad")))
        // ...unless its launcher name says it is the agent app.
        assertEquals("com.konasl.nagad", NagadRead.pickPackage(listOf("com.konasl.nagad" to "Uddokta")))
        assertNull(NagadRead.pickPackage(listOf("com.bkash.businessapp" to "bKash Agent")))
    }

    @Test fun rowTimesHaveNoYearAndUseTodayAndYesterday() {
        assertEquals(at(2026, 11, 11, 2, 33), NagadRead.timeOf("আজ, 02:33 AM", today))
        assertEquals(at(2026, 11, 11, 18, 19), NagadRead.timeOf("আজ, 06:19 PM", today))
        assertEquals(at(2026, 11, 10, 17, 15), NagadRead.timeOf("গতকাল, 05:15 PM", today))
        assertEquals(at(2026, 11, 8, 17, 18), NagadRead.timeOf("নভে 8, 05:18 PM", today))
        assertEquals(at(2026, 11, 9, 12, 50), NagadRead.timeOf("নভে 9, 12:50 PM", today))
        assertEquals(at(2026, 11, 11, 0, 5), NagadRead.timeOf("আজ, 12:05 AM", today))
        // Read on 2 January, "ডিসে 31" is last year.
        assertEquals(at(2026, 12, 31, 21, 0), NagadRead.timeOf("ডিসে 31, 09:00 PM", LocalDate.of(2027, 1, 2)))
        assertNull(NagadRead.timeOf("৳ 400", today))
        assertNull(NagadRead.timeOf("ক্যাশ ইন", today))
    }

    @Test fun amountsAndNumbers() {
        assertEquals(400.0, NagadRead.rowAmount("৳ 400")!!, 0.001)
        assertEquals(10000.0, NagadRead.rowAmount("৳ 10,000")!!, 0.001)
        assertEquals(1.64, NagadRead.rowAmount("৳ 1.64")!!, 0.001)
        assertEquals(10019.75, NagadRead.takaAmount("10,019.75 টাকা")!!, 0.001)
        assertNull(NagadRead.takaAmount("ব্যালেন্স জানতে ট্যাপ করুন"))
        assertEquals("017XXXX5537", NagadRead.party("017****5537"))
        assertEquals("016XXXX9601", NagadRead.party("01618749601"))
        assertEquals("76AOTUC5", NagadRead.trxOf("#76AOTUC5"))
        assertNull(NagadRead.trxOf("017****5537"))
        assertEquals("01618749601", NagadRead.digits("01618-749601"))
    }

    @Test fun theDirectionComesFromTheTitle() {
        assertEquals(false, NagadRead.kindOf("ক্যাশ ইন").incoming)
        assertEquals(true, NagadRead.kindOf("ক্যাশ আউট").incoming)
        assertTrue(NagadRead.kindOf("ক্যাশ ইন কমিশন").commission)
        assertEquals(true, NagadRead.kindOf("বিটুবি প্রাপ্ত").incoming)
        assertEquals(false, NagadRead.kindOf("বিটুবি প্রেরিত").incoming)
        assertNull(NagadRead.kindOf("লেনদেনের সমন্বয়").incoming)
    }

    @Test fun listRowsAreReadAndTheirCommissionRowGivesTheTrxId() {
        val rows = listOf(
            listOf("বিটুবি প্রাপ্ত", "013****7088", "৳ 10,000", "আজ, 06:19 PM"),
            listOf("ক্যাশ ইন", "016****9601", "৳ 100", "আজ, 01:18 PM"),
            listOf("ক্যাশ ইন কমিশন", "#76AR02YA", "৳ 0.41", "আজ, 01:18 PM"),
            listOf("ক্যাশ ইন", "017****5537", "৳ 400", "আজ, 02:33 AM"),
            listOf("ক্যাশ ইন কমিশন", "#76AOTUC5", "৳ 1.64", "আজ, 02:33 AM"),
            listOf("বিটুবি প্রেরিত", "013****7088", "৳ 10,000", "নভে 9, 12:50 PM"),
        ).map { NagadRead.rowOf(it, today)!! }
        val folded = NagadRead.fold(rows)
        assertEquals(4, folded.size)
        val cashIn = folded[1]
        assertEquals("76AR02YA", cashIn.trx)
        assertEquals(0.41, cashIn.commission!!, 0.001)
        assertEquals("ক্যাশ ইন | 016XXXX9601 | 01:18pm 11/11/26 | - ৳100 | কমিশন: + ৳0.41", NagadRead.serverLine(cashIn))
        assertEquals("বিটুবি প্রাপ্ত | 013XXXX7088 | 06:19pm 11/11/26 | + ৳10000", NagadRead.serverLine(folded[0]))
        assertEquals("বিটুবি প্রেরিত | 013XXXX7088 | 12:50pm 09/11/26 | - ৳10000", NagadRead.serverLine(folded[3]))
        assertEquals("opened ${at(2026, 11, 11, 2, 33)} 400 017XXXX5537 76AOTUC5", NagadRead.openedLine(folded[2]))
        assertNull(NagadRead.openedLine(folded[0]))
        // A row of a kind PayTrace does not know is not sent with a guessed sign.
        assertNull(NagadRead.serverLine(NagadRead.rowOf(listOf("লেনদেনের সমন্বয়", "৳ 50", "আজ, 09:00 AM"), today)!!))
    }

    @Test fun aRowNeedsItsTimeAndAmount() {
        assertNull(NagadRead.rowOf(listOf("ক্যাশ ইন", "017****5537", "৳ 400"), today))
        assertNull(NagadRead.rowOf(listOf("ক্যাশ ইন", "017****5537", "আজ, 02:33 AM"), today))
    }

    @Test fun theConfirmationSheetMustShowThisNumberAndAmount() {
        val sheet = listOf("ক্যাশ ইন", "আপনি কি নিম্নলিখিত তথ্য অনুসারে ক্যাশ ইন করতে চান?", "পরিমাণ: 100 টাকা", "প্রাপক: 01618-749601", "না", "হ্যাঁ")
        val c = NagadRead.confirmOf(sheet)
        assertEquals(100.0, c.amount!!, 0.001)
        assertEquals("01618749601", c.number)
        assertTrue(NagadRead.confirmMatches(c, "01618749601", 100.0))
        assertFalse(NagadRead.confirmMatches(c, "01618749602", 100.0))
        assertFalse(NagadRead.confirmMatches(c, "01618749601", 1000.0))
        // The form behind the sheet has "পরিমাণ" with no colon: it is never taken for the sheet's amount.
        val form = listOf("একাউন্ট নং", "পরিমাণ", "পিন", "সাবমিট")
        assertNull(NagadRead.confirmOf(form).amount)
        assertFalse(NagadRead.confirmMatches(NagadRead.confirmOf(form), "01618749601", 100.0))
        // Label and value as two pieces still read.
        assertEquals(100.0, NagadRead.confirmOf(listOf("পরিমাণ:", "100 টাকা", "প্রাপক:", "01618-749601")).amount!!, 0.001)
        assertEquals(Screen.CONFIRM, NagadRead.screenOf(form + sheet, listOf("একাউন্ট নং", "পরিমাণ", "পিন")))
    }

    @Test fun theReceiptIsRead() {
        val receipt = listOf("নগদ", "ক্যাশ ইন সফল", "প্রাপক: 01618-749601", "11 নভে 2026, 09:25 PM", "ট্রানজেকশন আইডি", "76AUL8CI",
            "পরিমাণ", "100 টাকা", "ফি", "0 টাকা", "কমিশন", "0.41 টাকা", "বর্তমান ব্যালেন্স", "9,920.16 টাকা", "কল", "এসএমএস", "পরবর্তী")
        assertEquals(Screen.RESULT, NagadRead.screenOf(receipt, emptyList()))
        val r = NagadRead.resultOf(receipt)
        assertEquals("01618749601", r.number)
        assertEquals("76AUL8CI", r.trx)
        assertEquals(0.41, r.commission!!, 0.001)
        assertEquals(9920.16, r.balance!!, 0.001)
    }

    @Test fun screensAreToldApart() {
        assertEquals(Screen.LOGIN, NagadRead.screenOf(listOf("মোবাইল নাম্বার", "01732-533847", "নগদ পিন", "সাইন ইন", "পিন নাম্বার ভুলে গিয়েছেন?"), emptyList()))
        assertEquals(Screen.BUSY, NagadRead.screenOf(listOf("মোবাইল নাম্বার", "নগদ পিন", "সাইন ইন হচ্ছে"), emptyList()))
        assertEquals(Screen.BUSY, NagadRead.screenOf(listOf("মোবাইল নাম্বার", "নগদ পিন", "সাইন ইন সফল"), emptyList()))
        val home = listOf("নগদ উদ্যোক্তা", "M/s Asif Traders", "ব্যালেন্স জানতে ট্যাপ করুন", "ক্যাশ ইন", "বিটুবি", "নিবন্ধন", "বিল পে", "ইএমআই পেমেন্ট", "লিমিট")
        assertEquals(Screen.HOME, NagadRead.screenOf(home, emptyList()))
        // After the tap the pill shows the figure; the tiles still say Home.
        assertEquals(Screen.HOME, NagadRead.screenOf(home.map { if (it.startsWith("ব্যালেন্স")) "10,019.75 টাকা" else it }, emptyList()))
        assertEquals(10019.75, NagadRead.balanceOf(listOf("নগদ উদ্যোক্তা", "10,019.75 টাকা", "ক্যাশ ইন"))!!, 0.001)
        val drawer = listOf("M/s Asif Traders", "+88 01732-533847", "রিকুইজিশন", "প্রাপ্তি স্বীকার", "বিবরণী", "সেটিংস", "সাইন আউট")
        assertEquals(Screen.DRAWER, NagadRead.screenOf(drawer + home, emptyList()))
        val statement = listOf("বিবরণী", "লিমিট", "লেনদেন", "লেনদেন সারসংক্ষেপ", "সর্বমোট নিবন্ধন")
        assertEquals(Screen.STATEMENT, NagadRead.screenOf(statement, emptyList()))
        assertFalse(NagadRead.onTransactions(emptyList()))
        assertTrue(NagadRead.onTransactions(listOf("মোবাইল নম্বর / ট্রানজ্যাকশন আইডি দিয়ে খুঁজুন")))
        assertEquals(Screen.DETAILS, NagadRead.screenOf(statement + listOf("ক্যাশ ইন", "একাউন্ট নং", "017****5537", "পরিমাণ", "400 টাকা", "ট্রানজেকশন আইডি", "76AOTUC5", "দিন ও সময়", "আজ, 02:33 AM", "বিবরণ"), emptyList()))
        assertEquals("76AOTUC5", NagadRead.after(listOf("একাউন্ট নং", "017****5537", "ট্রানজেকশন আইডি", "76AOTUC5"), NagadRead.TRX_L))
        assertEquals(Screen.PICKER, NagadRead.screenOf(statement + listOf("সব লেনদেন", "ক্যাশ ইন", "ক্যাশ আউট"), emptyList()))
        assertEquals(Screen.CASHIN, NagadRead.screenOf(listOf("ক্যাশ ইন", "একাউন্ট নং", "পরিমাণ", "পিন", "সাবমিট"), emptyList()))
        assertEquals(Screen.BUSY, NagadRead.screenOf(listOf("ক্যাশ ইন", "একাউন্ট নং", "ক্যাশ ইন ট্রান্সফার হচ্ছে"), emptyList()))
    }

    @Test fun aRefusalAndAWrongPinAreSeen() {
        assertTrue(NagadRead.refused(listOf("লেনদেন ব্যর্থ হয়েছে")))
        assertTrue(NagadRead.refused(listOf("Insufficient balance")))
        assertFalse(NagadRead.refused(listOf("ক্যাশ ইন সফল")))
        assertTrue(NagadRead.wrongPin(listOf("পিন নাম্বার ভুল")))
        assertFalse(NagadRead.wrongPin(listOf("পিন নাম্বার ভুলে গিয়েছেন?")))
    }

    @Test fun numberSearchMatchesTheHiddenNumber() {
        assertTrue(NagadRead.samePhone("017XXXX5537", "01712345537"))
        assertFalse(NagadRead.samePhone("017XXXX5537", "01712345538"))
    }
}

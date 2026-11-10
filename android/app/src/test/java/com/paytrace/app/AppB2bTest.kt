package com.paytrace.app

import com.paytrace.app.AppB2bRead.Screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Built from the owner's real recording of a B2B in the bKash Agent app (2026-11-10, Tk 5,000 to the DSO 01324245010, TrxID DKA1AWJZ9L). */
class AppB2bTest {
    private val digits = (0..9).map { it.toString() }
    private val order = B2bOrder("01324245010", 5000.0)
    private val own = "01706630756"

    private val home = listOf("ক্যাশ ইন", "বিটুবি ট্রান্সফার", "লোন", "পে বিল", "বিটুবি রিসিভ (ব্যাংক)", "বিটুবি সেন্ড (ব্যাংক)",
        "বিটুবি রিকোয়েস্ট", "সর্বশেষ লেনদেন", "রিফ্রেশ করুন", "ক্যাশ ইন", "- ৳410", "S", "SONAR BANGLA TRADERS_01706630756",
        "ব্যালেন্স জানতে ট্যাপ করুন", "হোম", "ইনবক্স", "QR স্ক্যান", "স্টেটমেন্ট")
    private val amountScreen = listOf("ডিএসও", "01324245010", "পরিমাণ", "৳25000", "৳50000", "৳100000", "৳250000",
        "ব্যবহারযোগ্য ব্যালেন্স:", "৳9441.03", "পরবর্তী ধাপে এগিয়ে যান", "বিটুবি ট্রান্সফার")
    private val pinScreen = listOf("ডিএসও", "৳5000.00", "পিন নাম্বার দিন", "নিশ্চিত করুন") + digits + "বিটুবি ট্রান্সফার"
    private val sheet = listOf("বিটুবি ট্রান্সফার নিশ্চিত করুন", "01324245010", "৳5000.00", "নতুন ব্যালেন্স", "৳4441.03",
        "বিটুবি ট্রান্সফার করতে ট্যাপ করে ধরে রাখুন")
    private val result = listOf("আপনার বিটুবি ট্রান্সফার সম্পন্ন হয়েছে", "01324245010", "02:56pm 10/11/26", "DKA1AWJZ9L",
        "পুরাতন ব্যালেন্স", "৳9441.03", "নতুন ব্যালেন্স", "৳4441.03", "৳5000.00", "হোম -এ ফিরে যাই")
    private val question = listOf("বিটূবি নিশ্চিত করুন", "আপনি কি ডিএসও'র উপস্থিতিতে তাৎক্ষণিকভাবে ক্যাশ 5000.0 টাকা বুঝে পেয়েছেন?",
        "না", "হ্যাঁ", "বিঃ দ্রঃ নিশ্চিত না করা পর্যন্ত কোন ধরণের লেনদেন করতে পারবেন না")
    private val rating = listOf("মতামত দিন", "ডিএসও’র সার্বিক সেবা সম্পর্কে আপনার অভিজ্ঞতা কেমন?", "খুবই খারাপ", "খারাপ",
        "মোটামুটি", "ভালো", "খুবই ভালো")
    private val login = listOf("English", "লগ ইন করুন আপনার বিকাশ একাউন্টে", "একাউন্ট নাম্বার", "+88", "বিকাশ পিন নাম্বার",
        "এজেন্ট পিন নাম্বার দিন", "পিন ভুলে গিয়েছেন?", "লগ ইন") + digits

    @Test fun everyRecordedScreenIsKnown() {
        assertEquals(Screen.LOGIN, AppB2bRead.screenOf(login, true))
        assertEquals(Screen.HOME, AppB2bRead.screenOf(home, false))
        assertEquals(Screen.AMOUNT, AppB2bRead.screenOf(amountScreen, false))
        assertEquals(Screen.PIN, AppB2bRead.screenOf(pinScreen, true))
        assertEquals(Screen.CONFIRM, AppB2bRead.screenOf(sheet, false))
        assertEquals(Screen.CONFIRM, AppB2bRead.screenOf(pinScreen + sheet, true))
        assertEquals(Screen.RESULT, AppB2bRead.screenOf(result, false))
        assertEquals(Screen.CASH_QUESTION, AppB2bRead.screenOf(question, false))
        assertEquals(Screen.RATING, AppB2bRead.screenOf(rating, false))
        // Sheets drawn over Home or over the result are the sheet.
        assertEquals(Screen.CASH_QUESTION, AppB2bRead.screenOf(home + question, false))
        assertEquals(Screen.CASH_QUESTION, AppB2bRead.screenOf(result + question, false))
        assertEquals(Screen.RATING, AppB2bRead.screenOf(home + rating, false))
        assertEquals(Screen.UNKNOWN, AppB2bRead.screenOf(listOf("[লোডিং বার্ড]"), false))
    }

    @Test fun theDsoMustBeExactlyTheSavedOne() {
        assertTrue(AppB2bRead.amountScreenOk(amountScreen, order, own))
        assertFalse(AppB2bRead.amountScreenOk(amountScreen.map { it.replace("01324245010", "01324245011") }, order, own))
        // Two DSOs on one screen: not ours to choose.
        assertFalse(AppB2bRead.amountScreenOk(amountScreen + "01999999999", order, own))
        assertFalse(AppB2bRead.amountScreenOk(listOf("ডিএসও", "পরিমাণ"), order, own))
        assertEquals(9441.03, AppCashInRead.usableBalance(amountScreen)!!, 0.001)
    }

    @Test fun thePinScreenMustShowExactlyThisAmount() {
        assertTrue(AppB2bRead.pinScreenOk(pinScreen, order, own))
        assertFalse(AppB2bRead.pinScreenOk(pinScreen.map { if (it == "৳5000.00") "৳50000.00" else it }, order, own))
        assertFalse(AppB2bRead.pinScreenOk(pinScreen + "01999999999", order, own))
    }

    @Test fun theHoldNeedsThisDsoAndThisAmount() {
        assertTrue(AppB2bRead.mayHold(sheet, order, own))
        assertFalse(AppB2bRead.mayHold(sheet.map { if (it == "৳5000.00") "৳500.00" else it }, order, own))
        assertFalse(AppB2bRead.mayHold(sheet.map { it.replace("01324245010", "01324245019") }, order, own))
        assertFalse(AppB2bRead.mayHold(sheet.filter { it != "01324245010" }, order, own))
        // The new balance printed after the amount is never taken for it.
        assertFalse(AppB2bRead.mayHold(sheet, B2bOrder("01324245010", 4441.03), own))
    }

    @Test fun theResultGivesTrxIdAndNewBalance() {
        val r = AppB2bRead.result(result, order, own)
        assertEquals("DKA1AWJZ9L", r.trx)
        assertEquals(4441.03, r.newBalance!!, 0.001)
        assertTrue(r.numberOk)
        assertTrue(r.amountOk)
    }

    @Test fun theCashQuestionIsAnsweredOnlyForThisAmount() {
        assertEquals(5000.0, AppB2bRead.questionAmount(question)!!, 0.001)
        assertTrue(AppB2bRead.mayAnswerYes(question, order))
        assertFalse(AppB2bRead.mayAnswerYes(question, B2bOrder("01324245010", 6000.0)))
        assertFalse(AppB2bRead.mayAnswerYes(question.map { it.replace("5000.0", "50000.0") }, order))
        assertEquals(5000.0, AppB2bRead.questionAmount(listOf("ক্যাশ ৫০০০ টাকা বুঝে পেয়েছেন?"))!!, 0.001)
        assertNull(AppB2bRead.questionAmount(rating))
    }

    @Test fun ordersOutsideTheLimitsAreRefusedOnThePhone() {
        assertTrue(order.sane())
        assertTrue(B2bOrder("01324245010", 250_000.0).sane())
        assertFalse(B2bOrder("01324245010", 250_000.01).sane())
        assertFalse(B2bOrder("01324245010", 99.0).sane())
        assertFalse(B2bOrder("0132424501", 5000.0).sane())
        assertFalse(B2bOrder("01324245010", 5000.001).sane())
    }
}

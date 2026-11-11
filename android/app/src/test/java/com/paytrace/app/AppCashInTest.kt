package com.paytrace.app

import com.paytrace.app.AppCashInRead.Screen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Built from the owner's real recording of a Cash In in the bKash Agent app (2026-11-10, Tk 200 to 01320352256, TrxID DKA5A92DQ5). */
class AppCashInTest {
    private val digits = (0..9).map { it.toString() }
    private val order = CashInOrder("bkash", "01320352256", 200.0)
    private val own = "01706630756"

    private val home = listOf("ক্যাশ ইন", "বিটুবি ট্রান্সফার", "লোন", "সর্বশেষ লেনদেন", "রিফ্রেশ করুন", "ক্যাশ ইন", "- ৳1,100",
        "SONAR BANGLA TRADERS_01706630756", "ব্যালেন্স জানতে ট্যাপ করুন", "হোম", "ইনবক্স", "QR স্ক্যান", "স্টেটমেন্ট")
    private val numberScreen = listOf("কাস্টমারের QR স্ক্যান করতে ট্যাপ করুন", "সব কন্ট্যাক্টস", "ক্যাশ ইন করুন 01320352256",
        "পরবর্তী ধাপে এগিয়ে যান", "ক্যাশ ইন")
    private val amountScreen = listOf("কাস্টমার", "01320352256", "অ্যামাউন্ট", "৳500", "৳1000", "৳2000", "৳5000",
        "ব্যবহারযোগ্য ব্যালেন্স:", "৳11407.68", "পরবর্তী ধাপে এগিয়ে যান", "ক্যাশ ইন")
    private val pinScreen = listOf("কাস্টমার", "৳200.00", "+ ৳0.75", "পিন নাম্বার দিন", "নিশ্চিত করুন", "ক্যাশ ইন") + digits
    private val sheet = listOf("ক্যাশ ইন নিশ্চিত করুন", "01320352256", "৳200.00", "নতুন ব্যালেন্স", "৳11208.43", "ক্যাশ ইন করতে ট্যাপ করে ধরে রাখুন")
    private val result = listOf("আপনার ক্যাশ ইন ট্রান্সফার সম্পন্ন হয়েছে", "01320352256", "03:05am 10/11/26", "DKA5A92DQ5",
        "পুরাতন ব্যালেন্স", "৳11407.68", "নতুন ব্যালেন্স", "৳11208.43", "৳200.00", "৳0.75", "অফার দেখুন", "হোম-এ ফিরে যান")
    private val login = listOf("English", "লগ ইন করুন আপনার বিকাশ একাউন্টে", "একাউন্ট নাম্বার", "+88", "বিকাশ পিন নাম্বার",
        "এজেন্ট পিন নাম্বার দিন", "পিন ভুলে গিয়েছেন?", "লগ ইন") + digits

    @Test fun everyRecordedScreenIsKnown() {
        assertEquals(Screen.LOGIN, AppCashInRead.screenOf(login, true))
        assertEquals(Screen.HOME, AppCashInRead.screenOf(home, false))
        assertEquals(Screen.NUMBER, AppCashInRead.screenOf(numberScreen, false))
        assertEquals(Screen.AMOUNT, AppCashInRead.screenOf(amountScreen, false))
        assertEquals(Screen.PIN, AppCashInRead.screenOf(pinScreen, true))
        assertEquals(Screen.CONFIRM, AppCashInRead.screenOf(sheet, false))
        // The sheet drawn over the PIN screen is still the sheet.
        assertEquals(Screen.CONFIRM, AppCashInRead.screenOf(pinScreen + sheet, true))
        assertEquals(Screen.RESULT, AppCashInRead.screenOf(result, false))
        assertEquals(Screen.UNKNOWN, AppCashInRead.screenOf(listOf("[লোডিং বার্ড]"), false))
    }

    @Test fun theNumberMustBeExactlyOurs() {
        assertEquals("01320352256", AppCashInRead.typedShown(numberScreen))
        assertTrue(AppCashInRead.numberOk(amountScreen, order.number, own))
        assertFalse(AppCashInRead.numberOk(amountScreen.map { it.replace("01320352256", "01320352257") }, order.number, own))
        // The agent's own number (beside its name) is never taken for the customer's.
        assertTrue(AppCashInRead.numbersIn(home, own).isEmpty())
        // A masked number is not a number.
        assertTrue(AppCashInRead.numbersIn(listOf("0132XXXX256"), null).isEmpty())
        // No number at all is not "matching".
        assertFalse(AppCashInRead.numberOk(listOf("কাস্টমার"), order.number, own))
    }

    @Test fun thePinScreenMustShowExactlyThisAmount() {
        assertTrue(AppCashInRead.pinScreenOk(pinScreen, order, own))
        assertFalse(AppCashInRead.pinScreenOk(pinScreen.map { if (it == "৳200.00") "৳2000.00" else it }, order, own))
        // The commission "+ ৳0.75" is never read as the amount.
        assertEquals(listOf(200.0), AppCashInRead.takaValues(pinScreen))
    }

    @Test fun theHoldOnlyWhenNumberAndAmountBothMatch() {
        assertTrue(AppCashInRead.mayHold(sheet, order, own))
        assertFalse(AppCashInRead.mayHold(sheet, order.copy(number = "01320352257"), own))
        assertFalse(AppCashInRead.mayHold(sheet, order.copy(amount = 2000.0), own))
        assertFalse(AppCashInRead.mayHold(sheet.filter { it != "01320352256" }, order, own))
        assertFalse(AppCashInRead.mayHold(sheet.filter { it != "৳200.00" }, order, own))
    }

    @Test fun theResultIsRead() {
        val r = AppCashInRead.result(result, order, own)
        assertEquals("DKA5A92DQ5", r.trx)
        assertEquals(11208.43, r.newBalance!!, 0.001)
        assertTrue(r.numberOk && r.amountOk)
        assertNull(AppCashInRead.result(listOf("আপনার ক্যাশ ইন ট্রান্সফার সম্পন্ন হয়েছে"), order, own).trx)
    }

    @Test fun theUsableBalanceAndWhatIsTyped() {
        assertEquals(11407.68, AppCashInRead.usableBalance(amountScreen)!!, 0.001)
        assertEquals(11407.68, AppCashInRead.usableBalance(listOf("ব্যবহারযোগ্য ব্যালেন্স: ৳11,407.68"))!!, 0.001)
        assertEquals("200", AppCashInRead.amountText(200.0))
        assertEquals("200.50", AppCashInRead.amountText(200.5))
        assertEquals("200", AppCashInRead.boxDigits("৳200"))
    }

    // English screens (recorder run 380c3c2f, 2026-11-11, a real Tk 200 Cash In to 01320352256, TrxID DKB8CCKAZY).
    // The PIN screen and the sheet were not caught by the recorder; they follow the English B2B screens of the same run.
    private val enHome = listOf("Cashin", "B2B Transfer", "Loan", "Recent Transactions", "Refresh", "Cash Out", "+ ৳500",
        "S", "SONAR BANGLA TRADERS_01706630756", "Tap for Balance", "Home", "Inbox", "Scan QR", "Statements")
    private val enNumber = listOf("Enter Customer name or number", "Tap to scan customer's QR", "All Contacts",
        "You have no saved contact", "Add new contact", "Cash In")
    private val enAmount = listOf("Customer", "01320352256", "Amount", "৳500", "৳1000", "৳2000", "৳5000", "৳0",
        "Available Balance:", "৳12237.07", "Proceed to the next step", "Cash In")
    // The PIN screen and the sheet as recorded later (run 573a9296, a real Tk 250 Cash In, DKB0CFV5UM): in English the PIN
    // screen DOES show the number, and the sheet says "Cash In Confirm" / "Tap and hold for Cash In".
    private val enPin = listOf("Customer", "01320352256", "৳200.00", "Commission", "+ ৳0.75", "Enter PIN", "Confirm") + digits + "Cash In"
    private val enSheet = listOf("Cash In Confirm", "01320352256", "৳200.00", "৳11674.77", "Tap and hold for Cash In")
    // The number page after typing: no "Cash In <number>" row, only the box and a Proceed button.
    private val enNumberTyped = listOf("Tap to scan customer's QR", "All Contacts", "No matching contact", "Proceed to the next step", "Cash In")
    private val enResult = listOf("Your Cash In transfer is complete.", "01320352256", "01:14pm 11/11/26", "DKB8CCKAZY",
        "৳12237.07", "৳12037.82", "৳200.00", "Commission", "৳0.75", "Check Offers", "Back to Home")
    private val enLogin = listOf("বাংলা", "Login to your bKash account", "Account Number", "+88", "01706630756",
        "bKash PIN Number", "Agent PIN", "Forgot your PIN?", "Log in") + digits

    @Test fun theEnglishScreensAreKnownToo() {
        assertEquals(Screen.LOGIN, AppCashInRead.screenOf(enLogin, true))
        assertEquals(Screen.HOME, AppCashInRead.screenOf(enHome, false))
        assertEquals(Screen.NUMBER, AppCashInRead.screenOf(enNumber, false))
        assertEquals(Screen.NUMBER, AppCashInRead.screenOf(enNumberTyped, false))
        assertNull(AppCashInRead.typedShown(enNumberTyped))
        assertEquals(Screen.AMOUNT, AppCashInRead.screenOf(enAmount, false))
        assertEquals(Screen.PIN, AppCashInRead.screenOf(enPin, true))
        assertEquals(Screen.CONFIRM, AppCashInRead.screenOf(enSheet, false))
        assertEquals(Screen.RESULT, AppCashInRead.screenOf(enResult, false))
        assertEquals(12237.07, AppCashInRead.usableBalance(enAmount)!!, 0.001)
        assertTrue(AppCashInRead.numberOk(enAmount, order.number, own))
        assertTrue(AppCashInRead.pinScreenOk(enPin, order, own))
        assertTrue(AppCashInRead.mayHold(enSheet, order, own))
        assertFalse(AppCashInRead.mayHold(enSheet.map { it.replace("01320352256", "01320352257") }, order, own))
        assertEquals("DKB8CCKAZY", AppCashInRead.result(enResult, order, own).trx)
        // The page title "Cash In" is not the typed-number row; a row that shows the number is.
        assertNull(AppCashInRead.typedShown(enNumber))
        assertEquals("01320352256", AppCashInRead.typedShown(enNumber + "Cash In 01320352256"))
        assertTrue(AppBanners.pinHint(enLogin))
        assertFalse(AppBanners.pinHint(enLogin - "Agent PIN"))
    }

    @Test fun aSavedContactShownInsteadOfTheNumberIsTapped() {
        // rubel's Xiaomi, 2026-11-11: the typed number belongs to a saved contact, so bKash lists the contact instead of
        // "ক্যাশ ইন করুন 01…" and Proceed did nothing four times.
        val screen = listOf("01757177858", "কাস্টমারের QR স্ক্যান করতে ট্যাপ করুন", "সব কন্ট্যাক্টস", "Rubel", "সব নাম্বার দেখুন", "পরবর্তী ধাপে এগিয়ে যান", "ক্যাশ ইন")
        assertEquals("Rubel", AppCashInRead.contactToTap(screen, "01757177858", "01757177858"))
        // A line with the number itself wins over the name, and the typing box is never it.
        assertEquals("01757 177858", AppCashInRead.contactToTap(screen.take(4) + "01757 177858" + screen.drop(4), "01757177858", "01757177858"))
        // No contact listed: nothing to tap.
        assertNull(AppCashInRead.contactToTap(listOf("01757177858", "All Contacts", "No matching contact", "Proceed to the next step"), "01757177858", "01757177858"))
        assertNull(AppCashInRead.contactToTap(listOf("", "All Contacts", "You have no saved contact", "Add new contact"), "01757177858", ""))
    }
}

package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/** A B2B transfer the dashboard told this phone to make: [amount] taka from the bKash agent wallet to its DSO [number]. */
data class B2bOrder(val number: String, val amount: Double) {
    /** The phone's own lock, beside the database's: a full 01 number and 100 to 250,000 taka, at most 2 decimals. */
    fun sane(): Boolean =
        Regex("^01[0-9]{9}$").matches(number) && amount >= LEAST && amount <= MOST && amount == Math.round(amount * 100.0) / 100.0

    companion object {
        const val LEAST = 100.0
        /** The largest quick-pick the bKash app itself offers on its B2B screen. */
        const val MOST = 250_000.0
    }
}

/** Reading the bKash Agent app's B2B Transfer screens (owner's recording 2026-11-10, bKash Business 3.10.2, Vivo: Tk 5,000 to
 *  the DSO 01324245010, TrxID DKA1AWJZ9L). Pure, so every rule is unit tested.
 *
 *  The screens, in order: Home (tile "বিটুবি ট্রান্সফার") > amount ("ডিএসও", the DSO's number, already filled in by bKash,
 *  "পরিমাণ", quick picks ৳25000 / ৳50000 / ৳100000 / ৳250000, "ব্যবহারযোগ্য ব্যালেন্স:", "পরবর্তী ধাপে এগিয়ে যান") > PIN
 *  ("ডিএসও", the amount "৳5000.00", "পিন নাম্বার দিন", "নিশ্চিত করুন"; NO number) > the sheet "বিটুবি ট্রান্সফার নিশ্চিত করুন"
 *  (number, amount, "নতুন ব্যালেন্স", "বিটুবি ট্রান্সফার করতে ট্যাপ করে ধরে রাখুন") > result ("আপনার বিটুবি ট্রান্সফার সম্পন্ন
 *  হয়েছে", number, time, TrxID, old and new balance, amount, "হোম -এ ফিরে যাই") > a sheet "বিটূবি নিশ্চিত করুন" asking "আপনি কি
 *  ডিএসও'র উপস্থিতিতে তাৎক্ষণিকভাবে ক্যাশ 5000.0 টাকা বুঝে পেয়েছেন?" (না / হ্যাঁ; the app takes no other transaction until it
 *  is answered) > sometimes a rating sheet ("মতামত দিন").
 *
 *  THE RULE, same as the app Cash In: money moves only on the tap-and-hold, and the phone holds only on the sheet that shows
 *  BOTH the saved DSO number and this amount, exactly. The number is checked on the amount screen, the amount on the PIN
 *  screen, both again on the sheet; any mismatch closes the sheet and nothing is sent. The cash question is answered "হ্যাঁ"
 *  only for this very amount, because the owner ticks "the DSO pays the cash" on the dashboard for every B2B. */
object AppB2bRead {
    enum class Screen { LOGIN, HOME, AMOUNT, PIN, CONFIRM, RESULT, CASH_QUESTION, RATING, UNKNOWN }

    const val TILE = "বিটুবি ট্রান্সফার"
    const val NEXT = AppCashInRead.NEXT
    const val CONFIRM_PIN = AppCashInRead.CONFIRM_PIN
    const val PIN_HINT = AppCashInRead.PIN_HINT
    const val HOLD_TEXT = "বিটুবি ট্রান্সফার করতে ট্যাপ করে ধরে রাখুন"
    const val YES = "হ্যাঁ"
    val HOME_BACK = setOf("হোম -এ ফিরে যাই", "হোম-এ ফিরে যাই", "হোম -এ ফিরে যান", "হোম-এ ফিরে যান")
    private const val DSO = "ডিএসও"
    private val QUESTION_AMOUNT = Regex("ক্যাশ\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*টাকা")

    fun screenOf(texts: List<String>, keypad: Boolean): Screen {
        val t = texts.map { it.trim() }
        fun has(s: String) = t.any { it == s }
        fun hasPart(s: String) = t.any { s in it }
        return when {
            // The cash question and the rating are sheets on top of another screen: they are read first.
            hasPart("বুঝে পেয়েছেন") -> Screen.CASH_QUESTION
            hasPart("মতামত দিন") || hasPart("সার্বিক সেবা") -> Screen.RATING
            hasPart("বিটুবি ট্রান্সফার সম্পন্ন") -> Screen.RESULT
            hasPart(HOLD_TEXT) || has("বিটুবি ট্রান্সফার নিশ্চিত করুন") -> Screen.CONFIRM
            keypad && (has("লগ ইন") || t.any { it.lowercase(Locale.ROOT) == "log in" }) -> Screen.LOGIN
            has(DSO) && has(CONFIRM_PIN) -> Screen.PIN
            has(DSO) && has("পরিমাণ") -> Screen.AMOUNT
            has("সর্বশেষ লেনদেন") -> Screen.HOME
            else -> Screen.UNKNOWN
        }
    }

    /** The amount screen names this DSO, and no other number. */
    fun amountScreenOk(texts: List<String>, order: B2bOrder, own: String?): Boolean =
        AppCashInRead.numberOk(texts, order.number, own)

    private fun same(a: Double?, b: Double) = a != null && Math.abs(a - b) < 0.005

    /** The PIN screen: its first plain taka value is the amount, and no number other than the DSO's shows. */
    fun pinScreenOk(texts: List<String>, order: B2bOrder, own: String?): Boolean =
        same(AppCashInRead.takaValues(texts).firstOrNull(), order.amount) &&
            AppCashInRead.numbersIn(texts, own).all { it == order.number }

    /** The sheet before the tap-and-hold: this DSO and, first, this amount. Only then may the phone hold. */
    fun mayHold(texts: List<String>, order: B2bOrder, own: String?): Boolean =
        AppCashInRead.numberOk(texts, order.number, own) && same(AppCashInRead.takaValues(texts).firstOrNull(), order.amount)

    data class Done(val trx: String?, val newBalance: Double?, val numberOk: Boolean, val amountOk: Boolean)

    fun result(texts: List<String>, order: B2bOrder, own: String?): Done {
        val trx = texts.map { it.trim() }.firstOrNull { Regex("^[A-Z0-9]{8,12}$").matches(it) && it.any(Char::isDigit) && it.any(Char::isLetter) }
        return Done(trx, AppCashInRead.valueAfter(texts, "নতুন ব্যালেন্স"), AppCashInRead.numberOk(texts, order.number, own),
            AppCashInRead.takaValues(texts).any { same(it, order.amount) })
    }

    /** The amount the cash question names ("ক্যাশ 5000.0 টাকা"), or null. Bangla digits are read too. */
    fun questionAmount(texts: List<String>): Double? {
        val joined = texts.joinToString(" ").map { c -> if (c in '০'..'৯') '0' + (c - '০') else c }.joinToString("")
        return QUESTION_AMOUNT.find(joined)?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull()
    }

    /** "হ্যাঁ" may be pressed only when the question names exactly this amount. */
    fun mayAnswerYes(texts: List<String>, order: B2bOrder): Boolean = same(questionAmount(texts), order.amount)
}

/** A B2B transfer through the bKash APP (owner 2026-11-10: "now we will build full b2b perform on app"). Told by the dashboard
 *  as a "btob" command (migration 083). Same pace and same rules as [AppCashIn]: finger taps, the PIN one checked digit at a time,
 *  a real press-and-hold only on the matching sheet, never tried again; anything unclear after the hold is
 *  no_answer_after_hold, which the dashboard shows as "check the wallet", never as "failed". */
object AppB2b {
    const val RUN_MS = 160_000L
    private const val TICK_MS = 700L
    private const val STUCK_MS = 25_000L
    private const val LOGIN_WAIT_MS = 15_000L
    private const val PIN_WAIT_MS = 15_000L
    private const val HOLD_WAIT_MS = 8_000L
    private const val RESULT_WAIT_MS = 40_000L
    /** After the result: how long to wait for bKash's cash question before finishing without it. */
    private const val QUESTION_WAIT_MS = 20_000L

    @Volatile internal var running = false

    fun start(ctx: Context, order: B2bOrder, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        fun fail(e: String) = done(UssdOutcome(false, null, e))
        if (!order.sane()) return fail("bad_b2b")
        if (!s.ussdAllowed) return fail("not_allowed")
        if (!s.cashInAllowed) return fail("cash_in_off")
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (running || AppReader.active() || UssdSession.active() || UssdApi.active()) return fail("busy")
        val keys = AppReader.pinKeys(UssdSetup.pinStore(app, UssdProviders.BKASH).get()) ?: return fail("no_pin")
        val pkg = AppRecorder.findApp(app) ?: return fail("no_bkash_app")
        val woke = when (ScreenWake.state(app)) {
            ScreenGate.State.LOCKED_SECURE -> return fail("phone_locked")
            ScreenGate.State.WAKE_NEEDED -> true
            ScreenGate.State.READY -> false
        }
        val own = s.walletNumberOf(UssdProviders.BKASH).takeIf { it.isNotBlank() }
        running = true
        val pace = AppReader.pace
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        val trace = ArrayList<String>()
        fun note(t: String) { if (trace.size < 45) trace.add(String.format(Locale.US, "%5.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, t)) }

        var finished = false
        var seenApp = 0L
        var nextActAt = 0L
        var progressAt = started
        var lastScreen = AppB2bRead.Screen.UNKNOWN
        var screenText = ""
        class Pin { var typed = 0; var pressed = false; var pressedAt = 0L; var retries = 0; var submittedAt = 0L }
        val loginPin = Pin()
        val b2bPin = Pin()
        var tilePresses = 0
        var nextPresses = 0
        var amountTyped = 0
        var pinBoxTaps = 0
        var backs = 0
        var held = false
        var heldAt = 0L
        var holdTries = 0
        var result: AppB2bRead.Done? = null
        var resultAt = 0L
        var homePresses = 0
        var answered = false
        var answerNote = ""
        var ratingCloses = 0

        fun finish(o: UssdOutcome, why: String) {
            if (finished) return
            finished = true
            running = false
            note("end: $why")
            val log = (trace + "screen: $screenText").joinToString("\n").take(1900)
            done(o.copy(trace = log, pinSent = held))
        }
        fun stop(error: String, why: String) =
            finish(UssdOutcome(false, null, if (held) "no_answer_after_hold" else error), why)
        fun succeed(why: String) {
            val r = result ?: return stop("no_answer_after_hold", "no result")
            val summary = "bKash app B2B\nto DSO: ${order.number}\namount: ${order.amount}\nTrxID: ${r.trx ?: "?"}\nnew balance: ${r.newBalance ?: "?"}" +
                (if (r.numberOk && r.amountOk) "" else "\nNOTE: the result screen did not show exactly this number and amount") +
                (if (answerNote.isBlank()) "" else "\n$answerNote")
            // The step log rides as its own screen (it starts with the mark the dashboard looks for), also on success.
            val log = "What the phone saw:\n" + trace.joinToString("\n").take(1800)
            finish(UssdOutcome(true, r.newBalance, null, trx = r.trx, screens = listOf(summary, log)), why)
        }

        AppReader.holdScreen(app, RUN_MS + 5_000, "appb2b")

        fun box(): AccessibilityNodeInfo? {
            val root = AppReader.bkashRoot(svc) ?: return null
            var found: AccessibilityNodeInfo? = null
            fun walk(n: AccessibilityNodeInfo?, depth: Int) {
                if (n == null || depth > 40 || found != null) return
                if (n.isEditable && !n.isPassword) { found = n; return }
                for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
            }
            walk(root, 0)
            return found
        }

        fun typeSlowly(text: String, now: Long): Long {
            var at = 0L
            box()?.let { b -> try { b.performAction(AccessibilityNodeInfo.ACTION_FOCUS) } catch (e: Exception) { } }
            for (i in 1..text.length) {
                at += pace.charGap()
                val part = text.substring(0, i)
                main.postDelayed({
                    box()?.let { b ->
                        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, part) }
                        try { b.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) } catch (e: Exception) { }
                    }
                }, at)
            }
            return now + at + pace.settle()
        }

        /** The "বিটুবি ট্রান্সফার" tile on Home, never a last-transaction row (those carry a ৳ amount). */
        fun pressTile(root: AccessibilityNodeInfo): Boolean {
            val nodes = ArrayList<AccessibilityNodeInfo>()
            AppReader.collect(root, nodes, 0)
            for (n in nodes) {
                if (n.text?.toString()?.trim() != AppB2bRead.TILE) continue
                var target: AccessibilityNodeInfo = n
                var p: AccessibilityNodeInfo? = n
                var hops = 0
                while (p != null && hops < 4) { if (p.isClickable) { target = p; break }; p = p.parent; hops++ }
                val words = ArrayList<String>()
                AppReader.words(target, words, 0)
                if (words.any { "৳" in it }) continue
                if (AppReader.tap(svc, target)) return true
                if (target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
            }
            return false
        }

        fun holdToSend(root: AccessibilityNodeInfo): Boolean {
            val nodes = ArrayList<AccessibilityNodeInfo>()
            AppReader.collect(root, nodes, 0)
            val target = nodes.firstOrNull { (it.contentDescription?.toString() ?: "").lowercase(Locale.ROOT).contains("tap and hold") }
                ?: nodes.firstOrNull { (it.text?.toString() ?: "").trim() == AppB2bRead.HOLD_TEXT }
                ?: return false
            val r = Rect()
            target.getBoundsInScreen(r)
            if (r.isEmpty) return false
            val (x, y) = pace.pointIn(r.left, r.top, r.right, r.bottom)
            val path = Path().apply { moveTo(x, y); lineTo(x + 1f, y) }
            return try {
                svc.dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, pace.holdPressMs())).build(), null, null)
            } catch (e: Exception) { false }
        }

        /** Closes a sheet by its close / cancel icon (the confirm sheet says "Cancel Icon", the others "শিট বন্ধ করুন"). */
        fun closeSheet(nodes: List<AccessibilityNodeInfo>): Boolean {
            val c = nodes.firstOrNull {
                val d = (it.contentDescription?.toString() ?: "").lowercase(Locale.ROOT)
                d == "close" || "cancel" in d || "শিট বন্ধ" in d
            } ?: return false
            return AppReader.tap(svc, c) || c.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        fun typePin(pin: Pin, root: AccessibilityNodeInfo, now: Long, canAct: Boolean, submit: () -> Boolean, label: String): Boolean {
            val shown = AppReader.pinShown(root)
            if (pin.typed == 0 && !pin.pressed && shown != null && shown > 0) {
                stop("pin_not_entered", "the $label PIN box already had digits in it; nothing typed")
                return false
            }
            when (PinTyping.next(pin.typed, keys.size, shown, pin.pressed, now - pin.pressedAt, pin.retries)) {
                PinTyping.Step.PRESS -> if (canAct) {
                    if (pin.typed == 0) note("$label PIN: typing slowly, one digit at a time")
                    progressAt = now
                    if (AppReader.pressText(svc, keys[pin.typed])) { pin.pressed = true; pin.pressedAt = now; pin.retries = 0 }
                    else { stop("pin_not_entered", "a key of the app's keypad could not be pressed"); return false }
                }
                PinTyping.Step.WAIT -> {}
                PinTyping.Step.CONFIRMED -> {
                    pin.typed++; pin.pressed = false; progressAt = now
                    nextActAt = now + if (pin.typed == keys.size) pace.afterKeys() else pace.keyGap()
                }
                PinTyping.Step.RETRY -> {
                    pin.retries++; pin.pressedAt = now; progressAt = now
                    note("$label PIN digit ${pin.typed + 1} did not show, pressing it again")
                    AppReader.pressText(svc, keys[pin.typed])
                }
                PinTyping.Step.LOGIN -> if (canAct) {
                    note("$label PIN box shows all ${keys.size} digits, pressing the button")
                    pin.submittedAt = now; progressAt = now
                    if (!submit()) note("$label button not found")
                    nextActAt = now + pace.settle()
                }
                PinTyping.Step.STOP -> { stop("pin_not_entered", "the $label PIN box showed the wrong number of digits; nothing pressed"); return false }
            }
            return true
        }

        val tick = object : Runnable {
            override fun run() {
                if (finished) return
                val now = SystemClock.elapsedRealtime()
                if (result != null && now - resultAt > QUESTION_WAIT_MS) {
                    if (!answered) answerNote = "bKash did not ask about the cash this time"
                    return succeed("result read")
                }
                if (now - started > RUN_MS) return if (result != null) succeed("time limit after the result") else stop("app_stopped_before_send", "time limit")
                try {
                    val root = AppReader.bkashRoot(svc)
                    if (root == null) {
                        if (seenApp == 0L && now - started > 20_000) return stop("app_not_opened", "the app did not open")
                        if (seenApp > 0 && now - seenApp > 20_000) return if (result != null) succeed("the app closed after the result") else stop("app_stopped_before_send", "the app left the screen")
                    } else {
                        if (seenApp == 0L) nextActAt = now + pace.settle()
                        seenApp = now
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        AppReader.collect(root, nodes, 0)
                        val texts = nodes.mapNotNull { n -> n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } }
                        screenText = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                        val keypad = (0..9).all { d -> texts.any { it == d.toString() } }
                        val screen = AppB2bRead.screenOf(texts, keypad)
                        if (screen != lastScreen) {
                            note("screen: ${screen.name.lowercase(Locale.ROOT)}")
                            lastScreen = screen
                            progressAt = now
                            if (nextActAt < now + 900) nextActAt = now + pace.settle()
                        }
                        val canAct = now >= nextActAt
                        // After the result: only the cash question, the rating sheet and Home matter; never anything that sends.
                        if (result != null) {
                            when (screen) {
                                AppB2bRead.Screen.CASH_QUESTION -> if (canAct && !answered) {
                                    answered = true
                                    if (AppB2bRead.mayAnswerYes(texts, order)) {
                                        note("bKash asks whether the DSO paid the cash for this amount: answering হ্যাঁ (the owner confirmed it on the dashboard)")
                                        if (!AppReader.pressAny(svc, setOf(AppB2bRead.YES), root)) {
                                            note("the হ্যাঁ button was not found")
                                            answerNote = "bKash asks whether the DSO paid the cash: please answer it on the phone"
                                        } else answerNote = "bKash asked whether the DSO paid the cash: answered yes"
                                    } else {
                                        note("bKash asks about a different amount (${AppB2bRead.questionAmount(texts)}): left for a person")
                                        answerNote = "bKash asks about a different amount: please answer it on the phone"
                                    }
                                    nextActAt = now + pace.settle()
                                }
                                AppB2bRead.Screen.RATING -> if (canAct && ratingCloses < 2) {
                                    ratingCloses++
                                    note("closing bKash's rating sheet without a rating")
                                    if (!closeSheet(nodes)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                    nextActAt = now + pace.settle()
                                }
                                AppB2bRead.Screen.RESULT -> if (canAct && homePresses < 2) {
                                    homePresses++
                                    AppReader.pressAny(svc, AppB2bRead.HOME_BACK, root)
                                    nextActAt = now + pace.settle()
                                }
                                AppB2bRead.Screen.HOME -> if (answered) return succeed("back on Home")
                                else -> {}
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        if (held && screen != AppB2bRead.Screen.RESULT && screen != AppB2bRead.Screen.CONFIRM) {
                            if (now - heldAt > RESULT_WAIT_MS) return stop("no_answer_after_hold", "no result after the hold")
                            main.postDelayed(this, TICK_MS); return
                        }
                        when (screen) {
                            AppB2bRead.Screen.LOGIN -> {
                                if (b2bPin.submittedAt > 0) return stop("app_stopped_before_send", "the app asked to log in again after the B2B PIN")
                                if (loginPin.submittedAt > 0) {
                                    if (now - loginPin.submittedAt > LOGIN_WAIT_MS) return stop("login_failed", "still on the login screen after the PIN")
                                } else if (!typePin(loginPin, root, now, canAct, { AppReader.pressAny(svc, AppReader.LOGIN) }, "login")) return
                            }
                            AppB2bRead.Screen.CASH_QUESTION ->
                                // Left over from an earlier B2B nobody answered: the app takes nothing until it is, and it is not ours.
                                return stop("b2b_question_open", "bKash still asks about an earlier B2B's cash; answer it on the phone first")
                            AppB2bRead.Screen.RATING -> if (canAct && ratingCloses < 2) {
                                ratingCloses++
                                note("closing a rating sheet")
                                if (!closeSheet(nodes)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                nextActAt = now + pace.settle()
                            }
                            AppB2bRead.Screen.HOME -> if (canAct) {
                                if (tilePresses >= 3) return stop("app_stopped_before_send", "the B2B tile did not open")
                                tilePresses++
                                note("home: pressing বিটুবি ট্রান্সফার")
                                if (!pressTile(root)) note("B2B tile not found")
                                nextActAt = now + pace.settle()
                            }
                            AppB2bRead.Screen.AMOUNT -> {
                                if (!AppB2bRead.amountScreenOk(texts, order, own)) return stop("dso_does_not_match", "the B2B screen names a different DSO number")
                                val usable = AppCashInRead.usableBalance(texts)
                                if (usable != null && usable + 0.005 < order.amount) return stop("insufficient_balance", "the wallet has less than the amount")
                                if (canAct) {
                                    val inBox = AppCashInRead.boxDigits(box()?.text?.toString())
                                    if (inBox.toDoubleOrNull()?.let { Math.abs(it - order.amount) < 0.005 } != true) {
                                        if (amountTyped >= 2) return stop("app_stopped_before_send", "the amount would not go into the box")
                                        amountTyped++
                                        note("DSO number matches; typing the amount")
                                        nextActAt = typeSlowly(AppCashInRead.amountText(order.amount), now)
                                    } else {
                                        if (nextPresses >= 6) return stop("app_stopped_before_send", "the amount screen did not move on")
                                        nextPresses++
                                        note("amount in the box, going on")
                                        if (!AppReader.pressAny(svc, setOf(AppB2bRead.NEXT), root)) note("next not found")
                                        nextActAt = now + pace.settle()
                                    }
                                }
                            }
                            AppB2bRead.Screen.PIN -> {
                                if (!AppB2bRead.pinScreenOk(texts, order, own)) return stop("confirm_does_not_match", "the PIN screen shows a different amount or number")
                                if (b2bPin.submittedAt > 0) {
                                    if (now - b2bPin.submittedAt > PIN_WAIT_MS) return stop("pin_refused", "still on the PIN screen after the PIN; never typed again")
                                } else if (!keypad) {
                                    if (canAct) {
                                        if (pinBoxTaps >= 3) return stop("app_stopped_before_send", "the PIN keypad did not open")
                                        pinBoxTaps++
                                        if (!AppReader.pressAny(svc, setOf(AppB2bRead.PIN_HINT), root)) note("PIN hint not found, waiting for the keypad")
                                        nextActAt = now + pace.settle()
                                    }
                                } else if (!typePin(b2bPin, root, now, canAct, { AppReader.pressAny(svc, setOf(AppB2bRead.CONFIRM_PIN), root) }, "B2B")) return
                            }
                            AppB2bRead.Screen.CONFIRM -> {
                                if (!AppB2bRead.mayHold(texts, order, own)) {
                                    note("the sheet does not show exactly this DSO and amount: closing it, nothing sent")
                                    closeSheet(nodes)
                                    if (!held) return stop("confirm_does_not_match", "the final sheet did not match")
                                    return stop("no_answer_after_hold", "the sheet changed after the hold")
                                }
                                if (canAct && (!held || now - heldAt > HOLD_WAIT_MS)) {
                                    if (holdTries >= 2) return stop("no_answer_after_hold", "the sheet still asks after two holds")
                                    holdTries++
                                    note(if (held) "the sheet still asks: holding once more" else "DSO and amount match exactly: tap and hold to send")
                                    if (holdToSend(root)) { held = true; heldAt = now; progressAt = now }
                                    else note("the hold area was not found")
                                    nextActAt = now + pace.holdPressMs() + 1_000
                                }
                            }
                            AppB2bRead.Screen.RESULT -> {
                                val r = AppB2bRead.result(texts, order, own)
                                result = r
                                resultAt = now
                                note("result: TrxID ${r.trx ?: "?"}, DSO ${if (r.numberOk) "matches" else "DIFFERS"}, amount ${if (r.amountOk) "matches" else "DIFFERS"}")
                                nextActAt = now + pace.readPause()
                            }
                            AppB2bRead.Screen.UNKNOWN -> {
                                if (b2bPin.submittedAt == 0L && canAct && now - progressAt > 8_000 && backs < 4) {
                                    backs++
                                    note("a screen PayTrace does not know: going back")
                                    svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                    nextActAt = now + pace.settle()
                                } else if (now - progressAt > STUCK_MS) {
                                    return stop("app_stopped_before_send", "a screen PayTrace does not know")
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    // A window that changed while being read; the next tick reads again.
                }
                main.postDelayed(this, TICK_MS)
            }
        }
        note("opening $pkg: B2B Tk ${order.amount} to DSO ${order.number}")
        AppReader.openBkash(svc, app, pkg, woke) { note(it) }
        main.postDelayed(tick, pace.settle())
    }
}

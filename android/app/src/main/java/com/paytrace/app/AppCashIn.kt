package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/** Reading the bKash Agent app's Cash In screens (owner's recording 2026-11-10, bKash Business 3.10.2, Vivo: Tk 200 to
 *  01320352256, TrxID DKA5A92DQ5). Pure, so every rule is unit tested.
 *
 *  The screens, in order: Home ("সর্বশেষ লেনদেন", the "ক্যাশ ইন" tile) > number ("সব কন্ট্যাক্টস", the typed number shown back as
 *  "ক্যাশ ইন করুন <number>", "পরবর্তী ধাপে এগিয়ে যান") > amount ("কাস্টমার", the number, "অ্যামাউন্ট", "ব্যবহারযোগ্য ব্যালেন্স:")
 *  > PIN ("কাস্টমার", the amount "৳200.00", the commission "+ ৳0.75", "নিশ্চিত করুন"; NO number) > the "ক্যাশ ইন নিশ্চিত করুন"
 *  sheet (number, amount, "নতুন ব্যালেন্স", "ক্যাশ ইন করতে ট্যাপ করে ধরে রাখুন") > result ("আপনার ক্যাশ ইন ট্রান্সফার সম্পন্ন
 *  হয়েছে", number, time, TrxID, old and new balance, amount, commission).
 *
 *  THE RULE (owner agreed 2026-11-10): money moves only on the tap-and-hold, and the phone holds only on the sheet that
 *  shows BOTH this number and this amount, exactly. The number is checked on the amount screen, the amount on the PIN screen,
 *  and both again on the sheet; any mismatch closes the sheet and nothing is sent. */
object AppCashInRead {
    enum class Screen { LOGIN, HOME, NUMBER, AMOUNT, PIN, CONFIRM, RESULT, UNKNOWN }

    // Every label in both of the app's languages (English from recorder run 380c3c2f, 2026-11-11), lower case, because
    // AppReader.pressAny compares lower case. The English Home tile says "Cashin" (one word).
    val TILE = setOf("ক্যাশ ইন", "cashin", "cash in")
    val NEXT = setOf("পরবর্তী ধাপে এগিয়ে যান", "proceed to the next step")
    val CONFIRM_PIN = setOf("নিশ্চিত করুন", "confirm")
    const val HOLD_TEXT = "ক্যাশ ইন করতে ট্যাপ করে ধরে রাখুন"
    val HOME_BACK = setOf("হোম-এ ফিরে যান", "হোম -এ ফিরে যান", "back to home")
    val PIN_HINT = setOf("পিন নাম্বার দিন", "enter pin")
    private val TYPED_PREFIX = listOf("ক্যাশ ইন করুন", "cash in")
    val NEW_BALANCE = listOf("নতুন ব্যালেন্স", "new balance")
    private val USABLE = listOf("ব্যবহারযোগ্য ব্যালেন্স", "available balance")
    private fun lc(s: String) = s.trim().lowercase(Locale.ROOT)
    private val NUMBER = Regex("01[0-9]{9}")
    private val TAKA = Regex("^৳\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)$")
    private val TRX = Regex("^[A-Z0-9]{8,12}$")

    fun screenOf(texts: List<String>, keypad: Boolean): Screen {
        val t = texts.map { lc(it) }
        fun has(vararg s: String) = s.any { w -> t.any { it == w } }
        fun hasPart(vararg s: String) = s.any { w -> t.any { w in it } }
        val customer = has("কাস্টমার", "customer")
        return when {
            hasPart("ক্যাশ ইন ট্রান্সফার সম্পন্ন", "cash in transfer is complete") -> Screen.RESULT
            hasPart(HOLD_TEXT) || has("ক্যাশ ইন নিশ্চিত করুন", "confirm cash in") ||
                t.any { "tap and hold" in it && "cash in" in it } -> Screen.CONFIRM
            keypad && has("লগ ইন", "log in") -> Screen.LOGIN
            customer && CONFIRM_PIN.any { has(it) } -> Screen.PIN
            customer && has("অ্যামাউন্ট", "amount") -> Screen.AMOUNT
            has("সব কন্ট্যাক্টস", "all contacts", "enter customer name or number") -> Screen.NUMBER
            has("সর্বশেষ লেনদেন", "recent transactions") -> Screen.HOME
            else -> Screen.UNKNOWN
        }
    }

    /** Every full 11-digit 01 number on screen (spaces and dashes ignored; a masked one like 0132XXXX256 is not a number),
     *  leaving out the agent's own number ([own]), which the app prints beside its name. */
    fun numbersIn(texts: List<String>, own: String?): List<String> =
        texts.flatMap { NUMBER.findAll(it.replace(" ", "").replace("-", "")).map { m -> m.value }.toList() }
            .filter { own.isNullOrBlank() || it != own }

    /** The number the number screen shows back after typing ("ক্যাশ ইন করুন 01320352256"), or null. */
    fun typedShown(texts: List<String>): String? =
        typedRow(texts)?.let { NUMBER.find(it.replace(" ", "").replace("-", ""))?.value }

    /** The row that shows the typed number back ("ক্যাশ ইন করুন 01320352256"): it starts with the prefix AND holds a number
     *  (the English page title "Cash In" alone is not it). */
    fun typedRow(texts: List<String>): String? =
        texts.firstOrNull { x -> TYPED_PREFIX.any { lc(x).startsWith(it) } && NUMBER.containsMatchIn(x.replace(" ", "").replace("-", "")) }

    /** Words on the number page that are never a saved contact. */
    private val NOT_CONTACT = setOf(
        "সব কন্ট্যাক্টস", "all contacts", "সব নাম্বার দেখুন", "see all numbers", "view all numbers",
        "কাস্টমারের qr স্ক্যান করতে ট্যাপ করুন", "tap to scan customer's qr", "no matching contact", "you have no saved contact",
        "add new contact", "enter customer name or number", "ক্যাশ ইন", "cash in", "cashin",
    )

    /** The number page when the typed number belongs to a SAVED CONTACT (rubel's Xiaomi, 2026-11-11): bKash lists the contact
     *  ("Rubel", "সব নাম্বার দেখুন") instead of the line "ক্যাশ ইন করুন 01…", and Proceed did not move on. Which text to tap:
     *  a line that is exactly this number (never the typing box itself), else the first contact name under "All Contacts".
     *  Null when no contact is listed. Tapping it is safe: the amount page must then show exactly this number, or nothing is sent. */
    fun contactToTap(texts: List<String>, number: String, boxText: String?): String? {
        val digits = { x: String -> x.replace(" ", "").replace("-", "") }
        var skipBox = boxDigits(boxText) == number
        for (x in texts) {
            if (digits(x) != number) continue
            if (skipBox) { skipBox = false; continue }
            return x
        }
        val head = texts.indexOfFirst { lc(it) == "সব কন্ট্যাক্টস" || lc(it) == "all contacts" }
        if (head < 0) return null
        for (x in texts.drop(head + 1)) {
            val l = lc(x)
            if (l in NEXT) return null
            if (l in NOT_CONTACT || x.isBlank() || x.all { it.isDigit() }) continue
            return x
        }
        return null
    }

    /** True when every number on screen (but the agent's own) is exactly [number], and there is at least one. */
    fun numberOk(texts: List<String>, number: String, own: String?): Boolean {
        val n = numbersIn(texts, own)
        return n.isNotEmpty() && n.all { it == number }
    }

    /** Unsigned taka values on screen in reading order ("৳200.00"; the commission "+ ৳0.75" has a sign and is left out). */
    fun takaValues(texts: List<String>): List<Double> =
        texts.mapNotNull { TAKA.find(it.trim())?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull() }

    private fun same(a: Double?, b: Double) = a != null && Math.abs(a - b) < 0.005

    /** The PIN screen: its first plain taka value is the amount, and no other number than this one shows. */
    fun pinScreenOk(texts: List<String>, order: CashInOrder, own: String?): Boolean =
        same(takaValues(texts).firstOrNull(), order.amount) && numbersIn(texts, own).all { it == order.number }

    /** The sheet before the tap-and-hold: it shows this number and, first, this amount. Only then may the phone hold. */
    fun mayHold(texts: List<String>, order: CashInOrder, own: String?): Boolean =
        numberOk(texts, order.number, own) && same(takaValues(texts).firstOrNull(), order.amount)

    /** The taka value printed right after the label [label] (or right after a text that starts with it). */
    fun valueAfter(texts: List<String>, label: String): Double? = valueAfter(texts, listOf(label))

    /** The same, for a label in either language. */
    fun valueAfter(texts: List<String>, labels: List<String>): Double? {
        val i = texts.indexOfFirst { x -> labels.any { lc(x).startsWith(lc(it)) } }
        if (i < 0) return null
        val label = labels.first { lc(texts[i]).startsWith(lc(it)) }
        // "ব্যবহারযোগ্য ব্যালেন্স: ৳11407.68" may be one text or two.
        TAKA.find(texts[i].trim().drop(label.trim().length).trim().trimStart(':').trim())?.let { return it.groupValues[1].replace(",", "").toDoubleOrNull() }
        return texts.drop(i + 1).firstNotNullOfOrNull { TAKA.find(it.trim())?.groupValues?.get(1)?.replace(",", "")?.toDoubleOrNull() }
    }

    fun usableBalance(texts: List<String>): Double? = valueAfter(texts, USABLE)

    data class Done(val trx: String?, val newBalance: Double?, val numberOk: Boolean, val amountOk: Boolean)

    /** The result screen: TrxID, the new balance, and whether it names this number and this amount. */
    fun result(texts: List<String>, order: CashInOrder, own: String?): Done {
        val trx = texts.map { it.trim() }.firstOrNull { TRX.matches(it) && it.any(Char::isDigit) && it.any(Char::isLetter) }
        return Done(trx, valueAfter(texts, NEW_BALANCE), numberOk(texts, order.number, own), takaValues(texts).any { same(it, order.amount) })
    }

    /** What is typed into the amount box: "200" for a whole amount, "200.50" otherwise. */
    fun amountText(amount: Double): String =
        if (amount == Math.floor(amount)) amount.toLong().toString() else String.format(Locale.US, "%.2f", amount)

    /** What a box holds, digits and one dot only (to compare with what was typed). */
    fun boxDigits(text: String?): String = (text ?: "").filter { it.isDigit() || it == '.' }
}

/** A bKash agent Cash In done through the bKash APP instead of USSD (owner 2026-11-10: "keep both ussd and app, i should be
 *  able to select"). Told by the dashboard as a cashin command with via = "app" (migration 082). Same pace as the app
 *  reader: finger taps, the PIN one checked digit at a time, a real press-and-hold. Never tried again by itself; once the
 *  hold is done, anything unclear is reported as no_answer_after_hold so the owner checks it ("unsure"), never "failed". */
object AppCashIn {
    const val RUN_MS = 150_000L
    private const val TICK_MS = 700L
    private const val STUCK_MS = 25_000L
    private const val LOGIN_WAIT_MS = 15_000L
    private const val PIN_WAIT_MS = 15_000L
    /** After the hold: how long to wait for the result before asking again (only while the sheet still asks). */
    private const val HOLD_WAIT_MS = 8_000L
    private const val RESULT_WAIT_MS = 40_000L

    @Volatile internal var running = false

    fun start(ctx: Context, order: CashInOrder, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        fun fail(e: String) = done(UssdOutcome(false, null, e))
        if (order.provider != UssdProviders.BKASH) return fail("unsupported")
        if (!order.sane()) return fail("bad_cash_in")
        if (!s.ussdAllowed) return fail("not_allowed")
        if (!s.cashInAllowed) return fail("cash_in_off")
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (running || AppReader.active() || UssdSession.active() || UssdApi.active()) return fail("busy")
        val keys = AppReader.pinKeys(UssdSetup.pinStore(app, UssdProviders.BKASH).get()) ?: return fail("no_pin")
        val pkg = AppRecorder.findApp(app) ?: return fail("no_bkash_app")
        // Asleep (or behind a swipe lock): the app is opened BY the wake window further down, exactly like the USSD runs
        // open the dialer, so the lock screen is pushed aside first (owner 2026-11-10: "if the phone screen is off it
        // just wakes and does not slide to proceed like it does on USSD").
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
        var lastScreen = AppCashInRead.Screen.UNKNOWN
        var screenText = ""
        // Login PIN and Cash In PIN: each typed one checked digit at a time (PinTyping), each submitted once.
        class Pin { var typed = 0; var pressed = false; var pressedAt = 0L; var retries = 0; var submittedAt = 0L }
        val loginPin = Pin()
        val cashPin = Pin()
        var tilePresses = 0
        var nextPresses = 0
        var pickTaps = 0
        var numberTyped = 0
        var amountTyped = 0
        var pinBoxTaps = 0
        var backs = 0
        var held = false
        var sawWalletError = false // bKash showed its own error during this run (not a wrong PIN)
        var reopens = 0
        var statusHits = 0
        val opener = AgentOpener { note(it) }
        var heldAt = 0L
        var holdTries = 0

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

        AppReader.holdScreen(app, RUN_MS + 5_000, "appcashin")
        fun launch() = AppReader.openBkash(svc, app, pkg, woke) { note(it) }

        /** The box being typed into (never the password box). */
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

        /** Types [text] into the box one character at a time, like fingers on a keyboard. Returns when it will be done. */
        fun typeSlowly(text: String, now: Long): Long {
            var at = 0L
            box()?.let { b ->
                try { b.performAction(AccessibilityNodeInfo.ACTION_FOCUS) } catch (e: Exception) { }
            }
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

        /** Taps the text [label] (a saved contact's name or number line), never the typing box. */
        fun tapText(root: AccessibilityNodeInfo, label: String): Boolean {
            val nodes = ArrayList<AccessibilityNodeInfo>()
            AppReader.collect(root, nodes, 0)
            val n = nodes.firstOrNull { !it.isEditable && it.text?.toString()?.trim() == label.trim() } ?: return false
            var target: AccessibilityNodeInfo = n
            var p: AccessibilityNodeInfo? = n
            var hops = 0
            while (p != null && hops < 4) { if (p.isClickable) { target = p; break }; p = p.parent; hops++ }
            if (AppReader.tap(svc, target)) return true
            return target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        }

        /** The "ক্যাশ ইন" tile on Home, never the last-transaction row under it (that row also says "ক্যাশ ইন", beside a ৳ amount). */
        fun pressTile(root: AccessibilityNodeInfo): Boolean {
            val nodes = ArrayList<AccessibilityNodeInfo>()
            AppReader.collect(root, nodes, 0)
            for (n in nodes) {
                if (n.text?.toString()?.trim()?.lowercase(Locale.ROOT) !in AppCashInRead.TILE) continue
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

        /** The press-and-hold that sends the money: on the bird (or the words under it), held 3-4 s, a finger kept still. */
        fun holdToSend(root: AccessibilityNodeInfo): Boolean {
            val nodes = ArrayList<AccessibilityNodeInfo>()
            AppReader.collect(root, nodes, 0)
            val target = nodes.firstOrNull { (it.contentDescription?.toString() ?: "").lowercase(Locale.ROOT).contains("tap and hold") }
                ?: nodes.firstOrNull { (it.text?.toString() ?: "").trim() == AppCashInRead.HOLD_TEXT || (it.text?.toString() ?: "").lowercase(Locale.ROOT).contains("tap and hold") }
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

        /** Types one PIN on the app's own keypad, a checked digit at a time; [submit] presses the button once the box is full. */
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
                if (now - started > RUN_MS) return stop("app_stopped_before_send", "time limit")
                try {
                    val root = AppReader.bkashRoot(svc)
                    if (root == null) {
                        if (seenApp == 0L && OpenRetry.due(false, now - started, reopens)) { reopens++; note("the app is not on screen yet: opening it again ($reopens)"); launch() }
                        if (seenApp == 0L && now - started > OpenRetry.GIVE_UP_MS) return stop("app_not_opened", "the app did not open")
                        if (seenApp > 0 && now - seenApp > 20_000) return stop("app_stopped_before_send", "the app left the screen")
                    } else {
                        if (seenApp == 0L) nextActAt = now + pace.settle()
                        seenApp = now
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        AppReader.collect(root, nodes, 0)
                        val texts = nodes.mapNotNull { n -> n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } }
                        screenText = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                        val keypad = (0..9).all { d -> texts.any { it == d.toString() } }
                        val screen = AppCashInRead.screenOf(texts, keypad)
                        if (screen != lastScreen) {
                            note("screen: ${screen.name.lowercase(Locale.ROOT)}")
                            lastScreen = screen
                            progressAt = now
                            if (nextActAt < now + 900) nextActAt = now + pace.settle()
                        }
                        val canAct = now >= nextActAt
                        // Once the hold is done only the result (or the sheet asking again) matters.
                        // bKash's own messages (recorder run a1460479). Before the hold nothing has been sent, so both stop safely.
                        if (!held) {
                            if (AppBanners.wrongPin(texts)) return stop(if (cashPin.submittedAt > 0) "pin_refused" else "login_failed", "bKash says the PIN is not correct; never typed again")
                            if (AppBanners.appError(texts)) sawWalletError = true
                            if (AppBanners.network(texts)) return stop("app_stopped_before_send", "bKash says: check your network (nothing was sent)")
                            // "Change the agent status" after login: while the status is CLOSE bKash will not do Cash In or
                            // B2B (owner 2026-11-11), so it is switched to OPEN and checked in the side menu first.
                            if (opener.active) {
                                when (opener.step(svc, nodes, texts, now, pace.settle())) {
                                    AgentOpener.Result.FAILED -> return stop("app_stopped_before_send", "the agent status could not be set to OPEN (nothing was sent)")
                                    AgentOpener.Result.DONE -> { progressAt = now; nextActAt = now + pace.settle() }
                                    AgentOpener.Result.WORKING -> progressAt = now
                                }
                                main.postDelayed(this, TICK_MS); return
                            }
                            if (AppBanners.agentStatus(texts)) {
                                if (canAct) {
                                    statusHits++
                                    if (statusHits > 3) return stop("app_stopped_before_send", "bKash keeps asking to change the agent status (nothing was sent)")
                                    opener.start(now)
                                }
                                main.postDelayed(this, TICK_MS); return
                            }
                        }
                        if (held && screen != AppCashInRead.Screen.RESULT && screen != AppCashInRead.Screen.CONFIRM) {
                            if (now - heldAt > RESULT_WAIT_MS) return stop("no_answer_after_hold", "no result after the hold")
                            main.postDelayed(this, TICK_MS); return
                        }
                        when (screen) {
                            AppCashInRead.Screen.LOGIN -> {
                                if (cashPin.submittedAt > 0) return stop("app_stopped_before_send", "the app asked to log in again after the Cash In PIN")
                                if (loginPin.submittedAt > 0) {
                                    if (now - loginPin.submittedAt > LOGIN_WAIT_MS) return stop(LoginTrouble.stuck(sawWalletError), "still on the login screen after the PIN" + if (sawWalletError) " (bKash showed its own error: not a wrong PIN)" else "")
                                } else {
                                    // bKash keeps Log in grey until the whole PIN is in: grey after the last digit = a digit was lost.
                                    if (loginPin.typed == keys.size && !loginPin.pressed) {
                                        when (LoginGate.decide(AppReader.buttonEnabled(nodes, AppReader.LOGIN), now - loginPin.pressedAt - PinTyping.BLIND_MS)) {
                                            LoginGate.Step.WAIT -> { main.postDelayed(this, TICK_MS); return }
                                            LoginGate.Step.STOP -> return stop("pin_not_entered", "the Log in button stayed grey after the PIN (a digit was lost); Log in NOT pressed")
                                            LoginGate.Step.PRESS -> {}
                                        }
                                    }
                                    if (!typePin(loginPin, root, now, canAct, { AppReader.pressAny(svc, AppReader.LOGIN) }, "login")) return
                                }
                            }
                            AppCashInRead.Screen.HOME -> if (canAct) {
                                if (tilePresses >= 3) return stop("app_stopped_before_send", "the Cash In tile did not open")
                                tilePresses++
                                note("home: pressing ক্যাশ ইন")
                                if (!pressTile(root)) note("Cash In tile not found")
                                nextActAt = now + pace.settle()
                            }
                            AppCashInRead.Screen.NUMBER -> if (canAct) {
                                val shown = AppCashInRead.typedShown(texts)
                                val inBox = AppCashInRead.boxDigits(box()?.text?.toString())
                                when {
                                    shown != null && shown != order.number -> return stop("confirm_does_not_match", "the app shows a different number")
                                    shown == order.number -> {
                                        if (nextPresses >= 4) return stop("app_stopped_before_send", "the number screen did not move on")
                                        nextPresses++
                                        note("number shown back exactly, going on")
                                        // Next first; if the screen stays, the row "ক্যাশ ইন করুন <number>" itself.
                                        val ok = if (nextPresses % 2 == 1) AppReader.pressAny(svc, AppCashInRead.NEXT, root)
                                                 else AppReader.pressAny(svc, setOf((AppCashInRead.typedRow(texts) ?: "").trim().lowercase(Locale.ROOT)), root)
                                        if (!ok) note("next not found")
                                        nextActAt = now + pace.settle()
                                    }
                                    inBox != order.number -> {
                                        if (numberTyped >= 2) return stop("app_stopped_before_send", "the number would not go into the box")
                                        numberTyped++
                                        note("typing the number")
                                        nextActAt = typeSlowly(order.number, now)
                                    }
                                    // The English page shows no "Cash In <number>" row (recorder run 573a9296): the box
                                    // itself holds exactly this number, so Proceed is pressed (it stays grey until it is whole).
                                    shown == null && inBox == order.number -> {
                                        if (nextPresses >= 6) return stop("app_stopped_before_send", "the number screen did not move on")
                                        // A saved contact shown instead of the number: tap it when Proceed is grey, and every
                                        // other time Proceed did nothing. The amount page checks the number again.
                                        val contact = AppCashInRead.contactToTap(texts, order.number, box()?.text?.toString())
                                        val nextLit = AppReader.buttonEnabled(nodes, AppCashInRead.NEXT)
                                        if (contact != null && (nextLit == false || nextPresses % 2 == 1)) {
                                            nextPresses++
                                            note("bKash shows a saved contact for this number: tapping it")
                                            if (!tapText(root, contact)) note("the contact could not be tapped")
                                        } else {
                                            nextPresses++
                                            note("the box shows exactly the number, going on")
                                            if (!AppReader.pressAny(svc, AppCashInRead.NEXT, root)) note("next not found")
                                        }
                                        nextActAt = now + pace.settle()
                                    }
                                    else -> { nextActAt = now + 1_500 }
                                }
                            }
                            AppCashInRead.Screen.AMOUNT -> {
                                if (!AppCashInRead.numberOk(texts, order.number, own)) return stop("confirm_does_not_match", "the amount screen shows a different number")
                                val usable = AppCashInRead.usableBalance(texts)
                                if (usable != null && usable + 0.005 < order.amount) return stop("insufficient_balance", "the wallet has less than the amount")
                                if (canAct) {
                                    val want = AppCashInRead.amountText(order.amount)
                                    val inBox = AppCashInRead.boxDigits(box()?.text?.toString())
                                    if (inBox.toDoubleOrNull()?.let { Math.abs(it - order.amount) < 0.005 } != true) {
                                        if (amountTyped >= 2) return stop("app_stopped_before_send", "the amount would not go into the box")
                                        amountTyped++
                                        note("typing the amount")
                                        nextActAt = typeSlowly(want, now)
                                    } else {
                                        if (nextPresses >= 8) return stop("app_stopped_before_send", "the amount screen did not move on")
                                        nextPresses++
                                        note("amount in the box, going on")
                                        if (!AppReader.pressAny(svc, AppCashInRead.NEXT, root)) note("next not found")
                                        nextActAt = now + pace.settle()
                                    }
                                }
                            }
                            AppCashInRead.Screen.PIN -> {
                                if (!AppCashInRead.pinScreenOk(texts, order, own)) return stop("confirm_does_not_match", "the PIN screen shows a different amount or number")
                                if (cashPin.submittedAt > 0) {
                                    if (now - cashPin.submittedAt > PIN_WAIT_MS) return stop("pin_refused", "still on the PIN screen after the PIN; never typed again")
                                } else if (!keypad) {
                                    if (canAct) {
                                        if (pinBoxTaps >= 3) return stop("app_stopped_before_send", "the PIN keypad did not open")
                                        pinBoxTaps++
                                        if (!AppReader.pressAny(svc, AppCashInRead.PIN_HINT, root)) {
                                            // The hint is gone once the box has focus; tap the PIN box itself.
                                            note("PIN hint not found, waiting for the keypad")
                                        }
                                        nextActAt = now + pace.settle()
                                    }
                                } else if (!typePin(cashPin, root, now, canAct, { AppReader.pressAny(svc, AppCashInRead.CONFIRM_PIN, root) }, "cash in")) return
                            }
                            AppCashInRead.Screen.CONFIRM -> {
                                if (!AppCashInRead.mayHold(texts, order, own)) {
                                    note("the sheet does not show exactly this number and amount: closing it, nothing sent")
                                    nodes.firstOrNull { (it.contentDescription?.toString() ?: "").lowercase(Locale.ROOT).let { d -> d == "close" || "close sheet" in d || "cancel" in d } }?.let { c ->
                                        if (!AppReader.tap(svc, c)) c.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                    }
                                    if (!held) return stop("confirm_does_not_match", "the final sheet did not match")
                                    return stop("no_answer_after_hold", "the sheet changed after the hold")
                                }
                                if (canAct && (!held || now - heldAt > HOLD_WAIT_MS)) {
                                    if (holdTries >= 2) return stop("no_answer_after_hold", "the sheet still asks after two holds")
                                    holdTries++
                                    note(if (held) "the sheet still asks: holding once more" else "number and amount match exactly: tap and hold to send")
                                    if (holdToSend(root)) { held = true; heldAt = now; progressAt = now }
                                    else note("the hold area was not found")
                                    nextActAt = now + pace.holdPressMs() + 1_000
                                }
                            }
                            AppCashInRead.Screen.RESULT -> {
                                val r = AppCashInRead.result(texts, order, own)
                                note("result: TrxID ${r.trx ?: "?"}, number ${if (r.numberOk) "matches" else "DIFFERS"}, amount ${if (r.amountOk) "matches" else "DIFFERS"}")
                                main.postDelayed({ AppReader.pressAny(svc, AppCashInRead.HOME_BACK) }, pace.readPause())
                                val summary = "bKash app Cash In\nto: ${order.number}\namount: ${order.amount}\nTrxID: ${r.trx ?: "?"}\nnew balance: ${r.newBalance ?: "?"}" +
                                    (if (r.numberOk && r.amountOk) "" else "\nNOTE: the result screen did not show exactly this number and amount")
                                return finish(UssdOutcome(true, r.newBalance, null, trx = r.trx, screens = listOf(summary)), "done")
                            }
                            AppCashInRead.Screen.UNKNOWN -> {
                                // The contact's own list of numbers ("সব নাম্বার দেখুন"): tap exactly this number, nothing else.
                                val numberLine = if (cashPin.submittedAt == 0L) texts.firstOrNull { it.replace(" ", "").replace("-", "") == order.number } else null
                                if (numberLine != null && canAct && pickTaps < 2) {
                                    pickTaps++
                                    note("a list of the contact's numbers: tapping this number")
                                    if (!tapText(root, numberLine)) note("the number could not be tapped")
                                    progressAt = now; nextActAt = now + pace.settle()
                                } else if (cashPin.submittedAt == 0L && canAct && now - progressAt > 8_000 && backs < 4) {
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
        note("opening $pkg: Cash In Tk ${order.amount} to ${order.number}")
        launch()
        main.postDelayed(tick, pace.settle())
    }
}

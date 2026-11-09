package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** Reads the bKash Agent app's own transaction list (owner 2026-11-10: "yes same pin, every 30 minutes, build it").
 *
 *  Why: the *247# statement shows only the newest few entries and no times, so Cash Ins and B2B sends (which bring no SMS
 *  PayTrace can rely on) went missing. The app's list goes back days with the exact minute of every entry. The read-only
 *  test (AppRecorder, build 170, Vivo) proved PayTrace's accessibility service can read it: package
 *  com.bkash.businessapp 3.10.2, login screen with the app's own 0-9 keypad and "লগ ইন", bottom tabs হোম / ইনবক্স /
 *  QR স্ক্যান / স্টেটমেন্ট, the list under ইনবক্স > লেনদেনসমূহ, each row "ক্যাশ ইন | 0173XXXX653 | 01:20am 09/11/26 |
 *  - ৳21,250 | কমিশন: + ৳79.69".
 *
 *  What it does, dashboard command "appread" (queued every 30 minutes by the server, or by the phone card's button):
 *  open the app; if it asks for the PIN, type the saved bKash agent PIN on the app's own keypad ONCE and press Log in
 *  (a second login screen = wrong PIN or a changed app: stop at once as login_failed, never type again; the server then
 *  stops queuing until the owner presses the button); open ইনবক্স > লেনদেনসমূহ; collect every complete row; scroll
 *  down until a row older than the cut-off, the end of the list, or the time limit; go Home; send the rows word for word.
 *  The SERVER reads the rows (like SMS), so a wording change needs no app update. It never taps a row and never sends
 *  money. The PIN is never written to the trace. */
object AppReader {
    const val KIND = "appread"
    /** The server fails a command running for 3 minutes. */
    const val RUN_MS = 150_000L
    private const val TICK_MS = 700L
    private val pace = HumanPace()
    /** No progress for this long on a screen we do not know: stop and say what was on it. */
    private const val STUCK_MS = 25_000L
    private const val LOGIN_WAIT_MS = 15_000L
    private const val MAX_SCROLLS = 60
    private const val MAX_ROWS = 400
    /** Going back after the list moved too far: at most this many swipes for one jump, and this many in one read. */
    private const val BACKS_PER_JUMP = 4
    private const val MAX_BACKS = 12
    /** Read back at least this far every time, and never more than [FAR_MS]; overlap is harmless (the server dedupes). */
    const val NEAR_MS = 6 * 3_600_000L
    const val FAR_MS = 48 * 3_600_000L
    const val TOTAL_CHARS = 14_000
    const val CHUNK_CHARS = 2_000

    private const val PREFS = "paytrace_appread"
    private const val NEWEST = "newest_at"

    @Volatile private var running = false
    fun active(): Boolean = running

    private val LOGIN = setOf("লগ ইন", "log in", "login")
    private val INBOX = setOf("ইনবক্স", "inbox")
    private val TAB = setOf("লেনদেনসমূহ", "transactions")
    private val TIME = Regex("^\\s*(\\d{1,2}):(\\d{2})\\s*([ap]m)\\s+(\\d{2})/(\\d{2})/(\\d{2,4})\\s*$", RegexOption.IGNORE_CASE)
    private val AMOUNT = Regex("^\\s*[+-]\\s*৳\\s*[\\d,]+(\\.\\d+)?\\s*$")

    /** Epoch ms of a row time like "01:20am 09/11/26" (Bangladesh time), or null. */
    fun timeOf(s: String): Long? {
        val m = TIME.matchEntire(s) ?: return null
        val y = m.groupValues[6].let { if (it.length == 2) "20$it" else it }
        val text = "${m.groupValues[1].padStart(2, '0')}:${m.groupValues[2]} ${m.groupValues[3].uppercase(Locale.US)} ${m.groupValues[4]}/${m.groupValues[5]}/$y"
        return try {
            SimpleDateFormat("hh:mm a dd/MM/yyyy", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("Asia/Dhaka")
                isLenient = false
            }.parse(text)?.time
        } catch (e: Exception) { null }
    }

    /** A row is kept only when the whole of it is on screen: its time and its signed amount. */
    fun complete(parts: List<String>): Boolean = parts.any { timeOf(it) != null } && parts.any { AMOUNT.matches(it) }

    fun rowTime(parts: List<String>): Long? = parts.firstNotNullOfOrNull { timeOf(it) }

    /** How far back to read: to 2 hours before the newest row already sent, but at least [NEAR_MS] and at most [FAR_MS]. */
    fun cutoff(newestSent: Long?, now: Long): Long {
        val far = now - FAR_MS
        if (newestSent == null || newestSent <= 0) return far
        return maxOf(far, minOf(newestSent - 2 * 3_600_000L, now - NEAR_MS))
    }

    /** The PIN as the keys to press, or null when it is not 4 to 6 plain digits. */
    fun pinKeys(pin: String): List<String>? = pin.trim().takeIf { Regex("^\\d{4,6}$").matches(it) }?.map { it.toString() }

    /** True when two reads of the list share no row: the list moved further than one screen between them, so rows in
     *  between were never seen. */
    fun jumped(before: Set<String>, now: Set<String>): Boolean = before.isNotEmpty() && now.isNotEmpty() && now.none { it in before }

    /** The rows newest first by their time (rows found while going back are older than some already kept). Rows of the
     *  same minute keep the order they were read in. */
    fun ordered(rows: Map<String, Long>): List<String> = rows.entries.sortedByDescending { it.value }.map { it.key }

    /** Header plus the rows (newest first), at most [TOTAL_CHARS] in all, in chunks of [CHUNK_CHARS]. The newest rows win. */
    fun pack(header: String, rows: List<String>): List<String> {
        val room = TOTAL_CHARS - header.length - 60
        val body = StringBuilder()
        var sent = 0
        for (r in rows) {
            if (body.length + r.length + 1 > room) break
            if (body.isNotEmpty()) body.append('\n')
            body.append(r)
            sent++
        }
        val out = arrayListOf("$header\nrows: ${rows.size}, sent: $sent".take(CHUNK_CHARS))
        // Cut between rows, never inside one, so the server always sees whole rows.
        val chunk = StringBuilder()
        for (line in body.split('\n')) {
            if (line.isEmpty()) continue
            if (chunk.isNotEmpty() && chunk.length + line.length + 1 > CHUNK_CHARS) { out.add(chunk.toString()); chunk.clear() }
            if (chunk.isNotEmpty()) chunk.append('\n')
            chunk.append(line.take(CHUNK_CHARS))
        }
        if (chunk.isNotEmpty()) out.add(chunk.toString())
        return out.take(12)
    }

    fun start(ctx: Context, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        fun fail(e: String, trace: String = "") = done(UssdOutcome(false, null, e, trace = trace))
        if (!AppSettings(app).ussdAllowed) return fail("not_allowed")
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (running || UssdSession.active() || UssdApi.active()) return fail("busy")
        val keys = pinKeys(UssdSetup.pinStore(app, UssdProviders.BKASH).get()) ?: return fail("no_pin")
        val pkg = AppRecorder.findApp(app) ?: return fail("no_bkash_app")
        when (ScreenWake.state(app)) {
            ScreenGate.State.LOCKED_SECURE -> return fail("phone_locked")
            ScreenGate.State.WAKE_NEEDED -> ScreenWake.wakeUp(app)
            ScreenGate.State.READY -> {}
        }
        running = true
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val started = SystemClock.elapsedRealtime()
        val cut = cutoff(prefs.getLong(NEWEST, 0L).takeIf { it > 0 }, System.currentTimeMillis())
        val trace = ArrayList<String>()
        fun note(s: String) { if (trace.size < 40) trace.add(String.format(Locale.US, "%5.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, s)) }
        val main = Handler(Looper.getMainLooper())
        val rows = LinkedHashMap<String, Long>()
        var seenApp = 0L
        var lastAct = 0L
        var nextActAt = 0L
        var progressAt = SystemClock.elapsedRealtime()
        var pinTypedAt = 0L      // when Log in was pressed
        var pinTyped = 0         // digits the PIN box has confirmed
        var keyPressed = false   // a digit was pressed and the box has not shown it yet
        var keyPressedAt = 0L
        var keyRetries = 0
        var pinBlind = false     // the box could not be read: typed by slow timing alone
        var scrolls = 0
        var idleScrolls = 0
        var prevFound: Set<String> = emptySet()
        var gapFrom: Set<String>? = null
        var backSteps = 0
        var totalBacks = 0
        // Forward swipes over rows already read after going back are not "the end of the list".
        var graceScrolls = 0
        var lastScreen = ""
        var finished = false

        fun launch() {
            try { svc.startActivity(app.packageManager.getLaunchIntentForPackage(pkg)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { note("could not open the app") }
        }

        fun finish(ok: Boolean, error: String?, why: String) {
            if (finished) return
            finished = true
            running = false
            note("end: $why, ${rows.size} rows")
            main.postDelayed({ try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { } }, 300)
            if (!ok) return done(UssdOutcome(false, null, error, trace = (trace + "screen: $lastScreen").joinToString("\n").take(1900)))
            val newest = rows.values.maxOrNull()
            if (newest != null) prefs.edit().putLong(NEWEST, newest).apply()
            val oldest = rows.values.minOrNull()
            val version = try { app.packageManager.getPackageInfo(pkg, 0).versionName ?: "?" } catch (e: Exception) { "?" }
            val header = "bKash app transactions\npackage: $pkg\nversion: $version\nstopped: $why\noldest: ${oldest ?: 0}\ncutoff: $cut"
            done(UssdOutcome(true, null, null, screens = pack(header, ordered(rows))))
        }

        val tick = object : Runnable {
            override fun run() {
                if (finished) return
                val now = SystemClock.elapsedRealtime()
                if (now - started > RUN_MS) return finish(rows.isNotEmpty(), "timeout", "time limit")
                try {
                    val root = bkashRoot(svc)
                    if (root == null) {
                        if (seenApp == 0L && now - started > 6_000 && lastAct == 0L) { lastAct = now; note("opening the app again"); launch() }
                        if (seenApp == 0L && now - started > 20_000) return finish(false, "app_not_opened", "the app did not open")
                        if (seenApp > 0 && now - seenApp > 20_000) return finish(rows.isNotEmpty(), "app_closed", "the app left the screen")
                    } else {
                        if (seenApp == 0L) nextActAt = now + pace.settle()
                        seenApp = now
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        collect(root, nodes, 0)
                        val texts = nodes.mapNotNull { n -> n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } }
                        lastScreen = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                        val canAct = now >= nextActAt
                        val found = rowsOn(nodes)
                        val loginKey = nodes.firstOrNull { n -> n.text?.toString()?.trim()?.lowercase(Locale.ROOT) in LOGIN }
                        val digits = (0..9).all { d -> nodes.any { it.text?.toString()?.trim() == d.toString() } }
                        when {
                            loginKey != null && digits -> {
                                if (pinTypedAt > 0) {
                                    if (now - pinTypedAt > LOGIN_WAIT_MS) return finish(false, "login_failed", "still on the login screen after the PIN")
                                } else {
                                    // One digit at a time, slowly: press it, wait until the PIN box shows one more digit,
                                    // and only then the next. Log in only when the box shows exactly the whole PIN
                                    // (owner 2026-11-10: the app lagged, taps were lost and a short PIN was sent).
                                    val shown = pinShown(root)
                                    if (shown == null) pinBlind = true
                                    if (pinTyped == 0 && !keyPressed && shown != null && shown > 0)
                                        return finish(false, "pin_not_entered", "the PIN box already had ${shown} digit(s) in it; nothing typed, Log in NOT pressed")
                                    when (PinTyping.next(pinTyped, keys.size, shown, keyPressed, now - keyPressedAt, keyRetries)) {
                                        PinTyping.Step.PRESS -> if (canAct) {
                                            if (pinTyped == 0) note("login screen: typing the saved PIN slowly, one digit at a time")
                                            progressAt = now
                                            if (pressText(svc, keys[pinTyped])) { keyPressed = true; keyPressedAt = now; keyRetries = 0 }
                                            else return finish(false, "pin_not_entered", "a key of the app's keypad could not be pressed; Log in NOT pressed")
                                        }
                                        PinTyping.Step.WAIT -> {}
                                        PinTyping.Step.CONFIRMED -> {
                                            pinTyped++; keyPressed = false; progressAt = now
                                            nextActAt = now + if (pinTyped == keys.size) pace.afterKeys() else pace.keyGap()
                                        }
                                        PinTyping.Step.RETRY -> {
                                            keyRetries++; keyPressedAt = now; progressAt = now
                                            note("digit ${pinTyped + 1} did not show in the box, pressing it again")
                                            pressText(svc, keys[pinTyped])
                                        }
                                        PinTyping.Step.LOGIN -> if (canAct) {
                                            note(if (pinBlind) "PIN typed slowly (the box could not be read), pressing Log in" else "the box shows all ${keys.size} digits, pressing Log in")
                                            pinTypedAt = now; progressAt = now
                                            if (!pressAny(svc, LOGIN)) note("login button not found")
                                            nextActAt = now + pace.settle()
                                        }
                                        PinTyping.Step.STOP -> return finish(false, "pin_not_entered",
                                            "the PIN box showed ${shown} digit(s) after digit ${pinTyped + (if (keyPressed) 1 else 0)} of ${keys.size}; Log in NOT pressed")
                                    }
                                }
                            }
                            found.isNotEmpty() -> {
                                val keysNow = found.map { it.first }.toSet()
                                // The list moved more than a screen since the last read: go back until it meets rows
                                // already read, so nothing in between is missed.
                                if (gapFrom == null && jumped(prevFound, keysNow) && totalBacks < MAX_BACKS) {
                                    gapFrom = rows.keys.toSet(); backSteps = 0; note("the list moved too far, going back")
                                }
                                prevFound = keysNow
                                var added = 0
                                for ((key, at) in found) if (!rows.containsKey(key) && rows.size < MAX_ROWS) { rows[key] = at; added++ }
                                if (added > 0) { progressAt = now; idleScrolls = 0 }
                                val back = gapFrom
                                if (back != null && keysNow.any { it in back }) { gapFrom = null; graceScrolls = backSteps + 1; note("back on rows already read") }
                                if (gapFrom != null) {
                                    if (canAct) {
                                        if (backSteps >= BACKS_PER_JUMP) { gapFrom = null; graceScrolls = backSteps + 1; note("could not find the rows above, going on") }
                                        else { backSteps++; totalBacks++; progressAt = now; nextActAt = now + pace.readPause(); swipe(svc, up = false) }
                                    }
                                    main.postDelayed(this, TICK_MS); return
                                }
                                val oldest = rows.values.minOrNull() ?: Long.MAX_VALUE
                                if (oldest < cut) return finish(true, null, "reached the cut-off")
                                if (rows.size >= MAX_ROWS) return finish(true, null, "row limit")
                                if (canAct) {
                                    if (added == 0) { if (graceScrolls > 0) graceScrolls-- else idleScrolls++ }
                                    if (idleScrolls >= 4) return finish(true, null, "end of the list")
                                    if (scrolls >= MAX_SCROLLS) return finish(true, null, "scroll limit")
                                    scrolls++
                                    nextActAt = now + pace.readPause()
                                    // A finger swipe; the list's own scroll only when swipes have stopped bringing new rows.
                                    if (idleScrolls >= 2 && scrollDown(svc, root)) note("scrolled by the list") else swipe(svc, up = true)
                                }
                            }
                            canAct && pressAny(svc, TAB, root) -> { nextActAt = now + pace.settle(); note("opened the transactions tab") }
                            canAct && pressAny(svc, INBOX, root) -> { nextActAt = now + pace.settle(); note("opened the inbox") }
                            else -> if (now - progressAt > STUCK_MS) return finish(rows.isNotEmpty(), "unexpected_screen", "a screen PayTrace does not know")
                        }
                    }
                } catch (e: Exception) {
                    // A window that changed while being read; the next tick reads again.
                }
                main.postDelayed(this, TICK_MS)
            }
        }
        note("opening $pkg, reading back to ${cut}")
        launch()
        main.postDelayed(tick, pace.settle())
    }

    private fun bkashRoot(svc: AccessibilityService): AccessibilityNodeInfo? {
        svc.rootInActiveWindow?.let { if (AppRecorder.isBkash(it.packageName?.toString())) return it }
        return try { svc.windows.mapNotNull { it.root }.firstOrNull { AppRecorder.isBkash(it.packageName?.toString()) } } catch (e: Exception) { null }
    }

    /** How many digits the PIN box shows: the password box (or the box whose hint says PIN), never the account box.
     *  Null when there is no such box to read. Never reads WHICH digits (a password box only gives dots). */
    private fun pinShown(root: AccessibilityNodeInfo): Int? {
        val boxes = ArrayList<AccessibilityNodeInfo>()
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 40 || boxes.size > 20) return
            if (n.isPassword || n.isEditable) boxes.add(n)
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        walk(root, 0)
        val box = boxes.firstOrNull { it.isPassword }
            ?: boxes.firstOrNull { b -> (b.hintText?.toString() ?: "").lowercase(Locale.ROOT).let { "পিন" in it || "pin" in it } }
            ?: return null
        return PinTyping.shownCount(box.text?.toString(), box.hintText?.toString())
    }

    /** Every node, skipping boxes being typed into. */
    private fun collect(n: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>, depth: Int) {
        if (n == null || depth > 40 || out.size > 1500) return
        if (n.isPassword || n.isEditable) return
        out.add(n)
        for (i in 0 until n.childCount) collect(n.getChild(i), out, depth + 1)
    }

    /** The complete rows on screen: a tappable node whose own words include a row time and a signed amount, as
     *  "word | word | ..." in screen order, with its time. Icons (descriptions) are left out. */
    private fun rowsOn(nodes: List<AccessibilityNodeInfo>): List<Pair<String, Long>> {
        val out = ArrayList<Pair<String, Long>>()
        for (n in nodes) {
            if (!n.isClickable || n.childCount == 0) continue
            val parts = ArrayList<String>()
            words(n, parts, 0)
            if (parts.size > 12 || !complete(parts)) continue
            val at = rowTime(parts) ?: continue
            out.add(parts.joinToString(" | ") to at)
        }
        return out
    }

    private fun words(n: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
        if (n == null || depth > 8 || n.isPassword || n.isEditable) return
        n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add(it.replace('\n', ' ').replace(" | ", " / ")) }
        for (i in 0 until n.childCount) words(n.getChild(i), out, depth + 1)
    }

    /** Presses the node whose whole text is [label] (or the nearest tappable thing around it). */
    private fun pressText(svc: AccessibilityService, label: String): Boolean = pressAny(svc, setOf(label))

    private fun pressAny(svc: AccessibilityService, labels: Set<String>, root0: AccessibilityNodeInfo? = null): Boolean {
        val root = root0 ?: bkashRoot(svc) ?: return false
        val nodes = ArrayList<AccessibilityNodeInfo>()
        collect(root, nodes, 0)
        val hit = nodes.firstOrNull { it.text?.toString()?.trim()?.lowercase(Locale.ROOT) in labels } ?: return false
        // Tap where the finger would: on the tappable thing around the words (a key, a tab), at a slightly different spot
        // each time. Only when the screen gives no position is the button pressed the invisible way.
        var target: AccessibilityNodeInfo = hit
        var p: AccessibilityNodeInfo? = hit
        var hops = 0
        while (p != null && hops < 4) {
            if (p.isClickable) { target = p; break }
            p = p.parent
            hops++
        }
        if (tap(svc, target)) return true
        return target.isClickable && target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun tap(svc: AccessibilityService, node: AccessibilityNodeInfo): Boolean {
        val r = Rect()
        node.getBoundsInScreen(r)
        if (r.isEmpty) return false
        val (x, y) = pace.pointIn(r.left, r.top, r.right, r.bottom)
        val path = Path().apply { moveTo(x, y) }
        return try {
            svc.dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, pace.tapMs())).build(), null, null)
        } catch (e: Exception) { false }
    }

    private fun scrollDown(svc: AccessibilityService, root: AccessibilityNodeInfo): Boolean {
        val nodes = ArrayList<AccessibilityNodeInfo>()
        collect(root, nodes, 0)
        val list = nodes.filter { it.isScrollable }.maxByOrNull { n -> Rect().also { n.getBoundsInScreen(it) }.let { it.width() * it.height() } }
            ?: return false
        return list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
    }

    /** A finger drag up (to older rows) or down (back to newer ones), then a short still hold before lifting, so the
     *  list does not fling on by itself. */
    private fun swipe(svc: AccessibilityService, up: Boolean) {
        val dm = svc.resources.displayMetrics
        val (fx, low, high) = pace.swipe().let { Triple(it[0], it[1], it[2]) }
        val x0 = (dm.widthPixels * fx).toFloat()
        val x1 = x0 + dm.widthPixels * 0.01f
        val y0 = (dm.heightPixels * (if (up) low else high)).toFloat()
        val y1 = (dm.heightPixels * (if (up) high else low)).toFloat()
        val path = Path().apply { moveTo(x0, y0); lineTo(x1, y1) }
        val hold = Path().apply { moveTo(x1, y1); lineTo(x1 + 1f, y1) }
        try {
            val move = GestureDescription.StrokeDescription(path, 0, pace.swipeMs(), true)
            svc.dispatchGesture(GestureDescription.Builder().addStroke(move).build(), object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    try {
                        svc.dispatchGesture(GestureDescription.Builder().addStroke(move.continueStroke(hold, 0, pace.holdMs(), false)).build(), null, null)
                    } catch (e: Exception) { }
                }
            }, null)
        } catch (e: Exception) { }
    }
}

/** Human pacing for driving the bKash app (owner 2026-11-10: "perform humanly, not too fast, smooth like a human"):
 *  uneven gaps between PIN digits, a pause after every new screen, a reading pause between scrolls, finger taps at a
 *  slightly different point inside a button each time, and swipes of varying length and speed. Pure given its Random. */
class HumanPace(private val rnd: java.util.Random = java.util.Random()) {
    private fun between(a: Long, b: Long): Long = a + (rnd.nextDouble() * (b - a)).toLong()
    private fun between(a: Double, b: Double): Double = a + rnd.nextDouble() * (b - a)
    /** Between PIN digits, after the box has shown the last one (owner 2026-11-10: the app lagged at 0.3-0.65 s). */
    fun keyGap(): Long = between(800L, 1_400L)
    fun afterKeys(): Long = between(1_000L, 1_600L)
    fun settle(): Long = between(1_800L, 3_200L)
    fun readPause(): Long = between(1_300L, 2_600L)
    fun tapMs(): Long = between(55L, 120L)
    /** A slow drag (the first Vivo read, build 173, used 0.4-0.7 s swipes: the list flung past 3 of 78 rows). */
    fun swipeMs(): Long = between(600L, 1_000L)
    /** The finger stays still this long before lifting, so the list stops where the finger stopped (no fling). */
    fun holdMs(): Long = between(220L, 380L)
    /** A point in the middle part of a box (30% to 70% across and down), never its edge. */
    fun pointIn(left: Int, top: Int, right: Int, bottom: Int): Pair<Float, Float> =
        (left + (right - left) * between(0.3, 0.7)).toFloat() to (top + (bottom - top) * between(0.3, 0.7)).toFloat()
    /** A swipe up the screen as fractions of its size: x, start y, end y (about a third of the screen, so every row is
     *  seen whole at least once). */
    fun swipe(): DoubleArray = doubleArrayOf(between(0.42, 0.58), between(0.70, 0.78), between(0.36, 0.44))
}

/** Typing a PIN on an app's own keypad one checked digit at a time. Pure, unit tested. */
object PinTyping {
    enum class Step { PRESS, WAIT, CONFIRMED, RETRY, LOGIN, STOP }

    /** A digit not shown after this long is pressed again (at most [RETRIES] times); with no box to read, a digit
     *  counts as typed after [BLIND_MS]. */
    const val SHOW_MS = 1_800L
    const val BLIND_MS = 1_600L
    const val RETRIES = 2

    /** Digits in the box: 0 when empty or showing its hint, else its length without spaces. */
    fun shownCount(text: String?, hint: String?): Int {
        val t = text ?: return 0
        if (t.isBlank() || t == hint) return 0
        return t.count { !it.isWhitespace() }
    }

    /** [typed] digits are confirmed; [pressed] = the next one was pressed [waitedMs] ago and [retries] times pressed again;
     *  [shown] = what the box shows (null = cannot be read). Log in only when the box shows exactly [total] digits. */
    fun next(typed: Int, total: Int, shown: Int?, pressed: Boolean, waitedMs: Long, retries: Int): Step {
        if (shown != null) {
            val most = typed + if (pressed) 1 else 0
            if (shown > most || shown < typed) return Step.STOP
        }
        if (pressed) {
            if (shown == null) return if (waitedMs >= BLIND_MS) Step.CONFIRMED else Step.WAIT
            if (shown == typed + 1) return Step.CONFIRMED
            if (waitedMs < SHOW_MS) return Step.WAIT
            return if (retries < RETRIES) Step.RETRY else Step.STOP
        }
        if (typed < total) return Step.PRESS
        return if (shown == null || shown == total) Step.LOGIN else Step.STOP
    }
}

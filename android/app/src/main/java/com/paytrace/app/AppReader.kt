package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
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
 *  The SERVER reads the rows (like SMS), so a wording change needs no app update. It never sends money. The PIN is never
 *  written to the trace.
 *
 *  For a held payment the server sends `look` (AppLook): the reader opens only that payment's own row to read its TrxID,
 *  and any TrxID still unread when the Inbox part is done is searched on the স্টেটমেন্ট page (owner 2026-11-10): tap
 *  "সার্চ করুন", type the TrxID slowly, check the box shows exactly it, press the keyboard's Search key, open the row that
 *  comes up only if it has that payment's minute, amount and number, and read the TrxID on its sheet. "কোনো লেনদেন
 *  পাওয়া যায়নি" decides nothing (the page sometimes shows nothing for a real payment). Search rows are sent with the
 *  others but never move "oldest", which the server's "not in the app" rule depends on. */
object AppReader {
    const val KIND = "appread"
    /** The owner's own search from the dashboard (owner 2026-11-11): a TrxID or a phone number, Statement search only. */
    const val SEARCH_KIND = "appsearch"
    /** The server fails a command running for 3 minutes. */
    const val RUN_MS = 150_000L
    private const val TICK_MS = 700L
    internal val pace = HumanPace()
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
    /** True while the reader OR an app cash-in drives the bKash app: USSD runs and each other wait. */
    fun active(): Boolean = running || AppCashIn.running || AppB2b.running || AppBalance.running || AppRecorder.recording()

    internal val LOGIN = setOf("লগ ইন", "log in", "login")
    private val INBOX = setOf("ইনবক্স", "inbox")
    private val TAB = setOf("লেনদেনসমূহ", "transactions")
    private val STATEMENT = setOf("স্টেটমেন্ট", "statement", "statements")
    /** The Statement page's own list tab. Since 2026-11-11 (owner: "statement main, inbox backup") this list is read first:
     *  the owner's recording showed it listing a real Tk 2,000 Cash Out the Inbox left out, with the commission on every row,
     *  while the Inbox first shows an old copy of itself for a few seconds. */
    private val HISTORY = setOf("লেনদেনের বিবরণী", "transaction history")
    private val SEARCH = setOf("সার্চ করুন", "search")
    /** Start the Statement search by this point of a run if TrxIDs are still unread, so it gets its share of the time. */
    private const val SEARCH_AT_MS = 95_000L
    /** One search: no result and no "nothing found" after this long = give up on that TrxID for this run. */
    private const val SEARCH_WAIT_MS = 12_000L
    /** How long to look for the Statement search box (the page may need swiping back up to show it). */
    private const val BOX_WAIT_MS = 40_000L
    /** After pressing Search, wait this long for the list to change before pressing it another way. */
    private const val RESUBMIT_MS = 5_000L
    /** How many different ways of pressing Search are tried (see submitTry). */
    private const val SUBMIT_WAYS = 3
    /** Time between touching the search box and the first letter (the keyboard opening). */
    private const val BOX_TOUCH_MS = 900L
    /** After filling the box, wait this long and read it again: what is still there then is what bKash kept. */
    private const val BOX_SETTLE_MS = 1_400L
    /** Before opening bKash: press Home and wait this long, so whatever was in front is put aside. */
    const val HOME_FIRST_MS = 700L
    /** bKash gone from the screen this long = another app came in front: open bKash again, up to [MAX_RELAUNCHES] times. */
    private const val LEFT_MS = 3_000L
    private const val MAX_RELAUNCHES = 3
    /** Steps back toward a page with the bottom tabs before giving up. */
    private const val MAX_WAY_BACK = 6
    private val HOME_BACK = setOf("back to home", "হোম-এ ফিরে যান", "হোম -এ ফিরে যান", "হোম-এ ফিরে যাই", "হোম -এ ফিরে যাই")
    /** At most this many swipes toward the newest end before reading the list (the app keeps its scroll position). */
    private const val TOP_SWIPES = 8
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

    /** The step log a successful read sends after its rows (owner 2026-11-10: "make it save the log"), so the dashboard
     *  shows how the login went. It never holds the PIN, and it has no " | ", so the server never reads it as a row. */
    const val TRACE_CHARS = 1_500
    const val TRACE_MARK = "What the phone saw:"

    /** Header plus the rows (newest first), at most [TOTAL_CHARS] in all, in chunks of [CHUNK_CHARS]. The newest rows win.
     *  A [trace], when given, goes last as its own screen beginning with [TRACE_MARK]. */
    fun pack(header: String, rows: List<String>, trace: String = "", opened: List<String> = emptyList()): List<String> {
        val log = if (trace.isBlank()) null else "$TRACE_MARK\n${trace.replace(" | ", " / ")}".take(TRACE_CHARS)
        // The rows the server asked to open, with the TrxID each showed (AppLook). Never contains " | ".
        val open = if (opened.isEmpty()) null else (AppLook.OPENED_MARK + "\n" + opened.joinToString("\n")).take(600)
        val room = TOTAL_CHARS - header.length - 60 - (log?.length ?: 0) - (open?.length ?: 0)
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
        val tail = listOfNotNull(open, log)
        return out.take(12 - tail.size) + tail
    }

    fun start(ctx: Context, look: AppLook? = null, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        fun fail(e: String, trace: String = "") = done(UssdOutcome(false, null, e, trace = trace))
        if (!AppSettings(app).ussdAllowed) return fail("not_allowed")
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (active() || UssdSession.active() || UssdApi.active()) return fail("busy")
        val keys = pinKeys(UssdSetup.pinStore(app, UssdProviders.BKASH).get()) ?: return fail("no_pin")
        val pkg = AppRecorder.findApp(app) ?: return fail("no_bkash_app")
        // Asleep (or behind a swipe lock): the app is opened BY the wake window further down, exactly like the USSD runs
        // open the dialer, so the lock screen is pushed aside first (owner 2026-11-10: "if the phone screen is off it
        // just wakes and does not slide to proceed like it does on USSD").
        val woke = when (ScreenWake.state(app)) {
            ScreenGate.State.LOCKED_SECURE -> return fail("phone_locked")
            ScreenGate.State.WAKE_NEEDED -> true
            ScreenGate.State.READY -> false
        }
        running = true
        // A search the owner typed (AppLook.query): log in, search the Statement for it, report what came up. No list read.
        val query = look?.query
        val byPhone = query != null && AppLook.isPhone(query)
        var outcome = ""             // what the search came to, for the dashboard
        val fullRows = LinkedHashSet<String>()   // result rows with the full number, for the dashboard only (no " | ")
        var sheetLine = ""           // the opened row's detail sheet, for the dashboard
        var phoneIdle = 0
        var phoneSwipes = 0
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val started = SystemClock.elapsedRealtime()
        val nowWall = System.currentTimeMillis()
        val cut = AppLook.cutoff(cutoff(prefs.getLong(NEWEST, 0L).takeIf { it > 0 }, nowWall), look, nowWall)
        // Rows the server asked to open for their TrxID (AppLook): each opened at most twice, then reported.
        val pending = ArrayList(look?.finds ?: emptyList())
        val tries = HashMap<String, Int>()
        val opened = ArrayList<String>()
        var opening: AppLook.Target? = null
        var openingAt = 0L
        var openingRowAt = 0L
        var openingAmount = 0.0
        var openingParty: String? = null
        // TrxIDs the Inbox already showed on their own row; the rest are searched for on the Statement page.
        val confirmed = HashSet<String>()
        // Statement search (owner 2026-11-10: "on statement you can search by transaction id"). A found row is opened and its
        // TrxID read like an Inbox row; "nothing found" decides NOTHING (the page sometimes shows nothing for a real one).
        var searching = false
        var searchWhy = ""
        val searchQueue = ArrayList<AppLook.Target>()
        var sTarget: AppLook.Target? = null
        var sStartedAt = 0L
        var sTypedAt = 0L       // when typing will be done
        var sSubmittedAt = 0L
        var sOpened = false
        var sTabs = 0
        var sSwipes = 0
        var sTries = 0          // how many ways of pressing Search were tried for this target
        var sTypeTries = 0      // typing is tried twice before the target is skipped
        val searchedRows = LinkedHashSet<String>()
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
        var allTypedAt = 0L      // when the last digit was counted as typed
        var retyping = false     // the app left the screen while the PIN was being typed and was opened again
        var relaunches = 0
        var netHits = 0
        var statusHits = 0
        var backs = 0
        var leftOpen = 0
        var scrolls = 0
        var idleScrolls = 0
        var prevFound: Set<String> = emptySet()
        // The list must be read from its newest end: bKash keeps the scroll position between visits, and a read that starts
        // halfway down never sees anything newer (2026-11-11: the 13:33 / 13:34 reads began at 13:15 / 11:38).
        var topped = false
        var useInbox = false     // the Statement list came up empty or never loaded: read the Inbox instead
        var listPresses = 0
        var topKey: String? = null
        var topSwipes = 0
        var gapFrom: Set<String>? = null
        var backSteps = 0
        var totalBacks = 0
        // Forward swipes over rows already read after going back are not "the end of the list".
        var graceScrolls = 0
        var lastScreen = ""
        var finished = false

        AppReader.holdScreen(app, RUN_MS + 5_000, "appread")
        fun launch() = AppReader.openBkash(svc, app, pkg, woke) { note(it) }

        fun finish(ok: Boolean, error: String?, why: String) {
            if (finished) return
            finished = true
            running = false
            note("end: $why, ${rows.size} rows")
            // A details sheet this run opened is closed before leaving, so the next run never finds the app covered by it.
            val left = try { bkashRoot(svc)?.let { r -> ArrayList<AccessibilityNodeInfo>().also { collect(r, it, 0) } } } catch (e: Exception) { null }
            val closing = left != null && detailsOpen(left) && closeSheet(svc, left)
            main.postDelayed({ try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { } }, if (closing) 900L else 300L)
            if (!ok) return done(UssdOutcome(false, null, error, trace = (trace + "screen: $lastScreen").joinToString("\n").take(1900)))
            if (query != null) {
                // The first screen is never read as rows by the server, so the full numbers can go here for the owner.
                val summary = listOf("bKash app search", "query: $query", "outcome: ${outcome.ifBlank { why }}",
                    "found: ${fullRows.size}") + fullRows.take(20).map { "row: $it" } +
                    (if (sheetLine.isNotBlank()) listOf("sheet: $sheetLine") else emptyList())
                return done(UssdOutcome(true, null, null, screens = pack(summary.joinToString("\n").replace(" | ", " · ").take(1800),
                    searchedRows.toList(), (trace + "end screen: $lastScreen").joinToString("\n"), opened)))
            }
            val newest = rows.values.maxOrNull()
            if (newest != null) prefs.edit().putLong(NEWEST, newest).apply()
            val oldest = rows.values.minOrNull()
            val version = try { app.packageManager.getPackageInfo(pkg, 0).versionName ?: "?" } catch (e: Exception) { "?" }
            val header = "bKash app transactions\npackage: $pkg\nversion: $version\nstopped: $why\noldest: ${oldest ?: 0}\ncutoff: $cut"
            // Rows found by the Statement search go out with the rest, but never count towards "oldest": the Inbox did
            // not read back that far, and the server's "not in the app" rule depends on how far the Inbox read.
            val out = ordered(rows) + searchedRows.filter { it !in rows }
            done(UssdOutcome(true, null, null, screens = pack(header, out, (trace + "end screen: $lastScreen").joinToString("\n"), opened)))
        }

        // The Inbox part is over: search the Statement for the TrxIDs still unread, if there is time; else finish.
        fun wrapUp(why: String) {
            if (searching) return
            val left = look?.finds.orEmpty().filter { it.trx !in confirmed }
            if (left.isEmpty() || SystemClock.elapsedRealtime() - started > RUN_MS - 25_000) return finish(true, null, why)
            searching = true; searchWhy = why
            searchQueue.clear(); searchQueue.addAll(left)
            note("$why; searching the Statement for ${left.size} TrxID(s)")
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
                        if (seenApp > 0 && now - seenApp > LEFT_MS && relaunches < MAX_RELAUNCHES) {
                            relaunches++
                            val front = try { svc.rootInActiveWindow?.packageName?.toString() } catch (e: Exception) { null }
                            note("the bKash app left the screen (in front: ${front ?: "nothing readable"}); opening it again")
                            if (pinTypedAt == 0L && (pinTyped > 0 || keyPressed)) { retyping = true; pinTyped = 0; keyPressed = false; keyRetries = 0 }
                            launch(); seenApp = now
                        }
                        if (seenApp > 0 && now - seenApp > 20_000) return finish(rows.isNotEmpty() || fullRows.isNotEmpty(), "app_closed", "the app left the screen")
                    } else {
                        if (seenApp == 0L) nextActAt = now + pace.settle()
                        seenApp = now
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        collect(root, nodes, 0)
                        val texts = nodes.mapNotNull { n -> n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } }
                        lastScreen = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                        val canAct = now >= nextActAt
                        // bKash's own messages over the app (recorder run a1460479): a wrong PIN is final, never typed again;
                        // "check your network" is closed and waited out, three times at most.
                        if (AppBanners.wrongPin(texts)) return finish(false, "login_failed", "bKash says the PIN is not correct")
                        if (AppBanners.network(texts)) {
                            if (canAct) {
                                netHits++
                                note("bKash says: check your network ($netHits)")
                                if (netHits >= 3) return finish(rows.isNotEmpty(), "no_network", "the bKash app has no network")
                                closeBanner(svc, nodes)
                                progressAt = now; nextActAt = now + pace.settle() + 4_000
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        if (AppBanners.agentStatus(texts)) {
                            if (canAct) {
                                statusHits++
                                if (statusHits > 3) return finish(rows.isNotEmpty(), "unexpected_screen", "bKash keeps asking to change the agent status")
                                note("bKash asks to change the agent status (it says CLOSE): closing the question with its X, the status is left as it is")
                                if (!closeAgentStatus(svc, nodes)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                progressAt = now; nextActAt = now + pace.settle()
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        // A transaction's details left open (by an earlier run or by a person) covers the app: close it at once,
                        // the sheet's own Close button and the phone's Back key in turn (owner 2026-11-11: "a transaction was open
                        // and it did nothing until I closed it").
                        if (opening == null && detailsOpen(nodes)) {
                            if (canAct) {
                                leftOpen++
                                if (leftOpen > 6) return finish(rows.isNotEmpty() || fullRows.isNotEmpty(), "unexpected_screen", "a transaction's details would not close")
                                val how = if (leftOpen % 2 == 1 && closeSheet(svc, nodes)) "pressed its Close" else { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK); "pressed Back" }
                                note("a transaction's details were left open: $how")
                                progressAt = now; nextActAt = now + 1_500
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        // A row we opened for its TrxID: read the sheet, then close it and go on with the list.
                        val o = opening
                        if (o != null) {
                            if (canAct) {
                                val read = if (AppLook.sheetIs(texts, o)) AppLook.trxOn(texts) else null
                                if (read != null || now - openingAt > 8_000) {
                                    opened.add(AppLook.line(openingRowAt, openingAmount, openingParty, read))
                                    if (query != null && read != null) {
                                        sheetLine = AppRecorder.safeLines(texts).joinToString(" · ").take(500)
                                        outcome = if (read == query) "found" else "a different TrxID: $read"
                                    } else if (query != null) outcome = "a row came up, but its TrxID could not be read"
                                    if (read != null) { pending.remove(o); note("row ${o.trx.take(2)}… opened: TrxID ${if (read == o.trx) "matches" else "is a different one"}") }
                                    else note("an opened row showed no TrxID")
                                    if (read == o.trx) confirmed.add(o.trx)
                                    if (searching) sTarget = null
                                    opening = null
                                    progressAt = now
                                    // Back only when a sheet is really showing: on the plain list it would leave the transactions screen.
                                    if (!closeSheet(svc, nodes) && (read != null || AppLook.sheetIs(texts, o))) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                    nextActAt = now + pace.settle()
                                }
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        if (query != null && !searching && texts.any { it.trim().lowercase(Locale.ROOT) in STATEMENT }) {
                            searching = true; searchWhy = "search"
                            searchQueue.clear(); searchQueue.add(AppLook.Target(query, 0L, 0.0, null))
                            note("logged in; searching the Statement for ${if (byPhone) "a phone number" else "a TrxID"}")
                        }
                        if (!searching && look != null && now - started > SEARCH_AT_MS && look.finds.any { it.trx !in confirmed }) wrapUp("time to search")
                        if (searching) {
                            if (!canAct) { main.postDelayed(this, TICK_MS); return }
                            if (sTarget == null) {
                                if (searchQueue.isEmpty()) return finish(true, null, "$searchWhy, Statement searched")
                                if (now - started > RUN_MS - 15_000) return finish(true, null, "$searchWhy, no time left to search")
                                sTarget = searchQueue.removeAt(0); sStartedAt = now; sTypedAt = 0L; sSubmittedAt = 0L; sOpened = false; sTabs = 0; sSwipes = 0; sTries = 0; sTypeTries = 0
                            }
                            val t = sTarget!!
                            val label = "${t.trx.take(4)}…"
                            // Did bKash really run the search? A searched list shows FULL numbers (01320352256) where the plain
                            // list hides them (0132XXXX256), or says "No transaction was found". Owner 2026-11-11: the first
                            // searches typed the TrxID and pressed Search but the list never changed.
                            val applied = AppLook.searchShown(nodes.filter { idEnds(it, "tag_transaction_reference") }.map { it.text?.toString() ?: "" }, texts)
                            if (sSubmittedAt > 0 && !applied && sTries < SUBMIT_WAYS && now - sSubmittedAt > RESUBMIT_MS) {
                                val box = searchBox(svc)
                                val shown = box?.text?.toString()?.trim()?.uppercase(Locale.ROOT)
                                if (shown == t.trx) {
                                    val how = submitTry(svc, box, nodes, sTries); sTries++
                                    note("Statement: the list did not change, pressing Search again ($how)")
                                    sSubmittedAt = now; progressAt = now; nextActAt = now + pace.settle()
                                    main.postDelayed(this, TICK_MS); return
                                }
                            }
                            // Its own row on screen (the search result, or the plain Statement list): open it and read its TrxID.
                            // The owner's own search: a TrxID brings ONE row (opened for its TrxID); a phone number brings
                            // that customer's rows (only rows showing that number are taken; the plain list may still show).
                            if (query != null && sSubmittedAt > 0 && now - sSubmittedAt > 1_500 && !sOpened) {
                                val on = rowNodesOn(nodes)
                                if (byPhone) {
                                    val mine = on.filter { (parts, _, _) -> AppLook.partyOf(parts) == AppLook.mask(query) }
                                    if (mine.isNotEmpty()) {
                                        val before = fullRows.size
                                        mine.forEach { (parts, _, _) -> searchedRows.add(AppLook.maskedRow(parts)); fullRows.add(parts.joinToString(" · ") { it.trim() }) }
                                        outcome = "found"
                                        if (fullRows.size == before) phoneIdle++ else phoneIdle = 0
                                        if (phoneIdle >= 2 || phoneSwipes >= 6) { note("search: ${fullRows.size} row(s) for this number"); sTarget = null }
                                        else { phoneSwipes++; swipe(svc, up = true); progressAt = now; nextActAt = now + pace.readPause() }
                                        main.postDelayed(this, TICK_MS); return
                                    }
                                } else if (on.size == 1 && (applied || sTries >= SUBMIT_WAYS)) {
                                    val (parts, at, node) = on[0]
                                    searchedRows.add(AppLook.maskedRow(parts))
                                    fullRows.add(parts.joinToString(" · ") { it.trim() })
                                    sOpened = true
                                    val amount = AppLook.amountOf(parts) ?: 0.0
                                    opening = AppLook.Target(query, at, amount, AppLook.partyOf(parts)); openingAt = now; openingRowAt = at
                                    openingAmount = amount; openingParty = AppLook.partyOf(parts)
                                    note("search: one row came up, opening it for its TrxID")
                                    if (!tap(svc, node)) node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                    progressAt = now; nextActAt = now + pace.settle()
                                    main.postDelayed(this, TICK_MS); return
                                }
                            }
                            val hit = if (sOpened || query != null) null else rowNodesOn(nodes).firstOrNull { (parts, _, _) -> AppLook.matches(parts, t) }
                            if (hit != null) {
                                val (parts, at, node) = hit
                                searchedRows.add(AppLook.maskedRow(parts))
                                sOpened = true
                                opening = t; openingAt = now; openingRowAt = at
                                openingAmount = AppLook.amountOf(parts) ?: t.amount
                                openingParty = AppLook.partyOf(parts)
                                note("Statement: $label found, opening it")
                                if (!tap(svc, node)) node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                progressAt = now; nextActAt = now + pace.settle()
                            } else if (sSubmittedAt > 0 && AppLook.nothingFound(texts)) {
                                note("Statement: $label no transaction found (decides nothing)"); sTarget = null; nextActAt = now + pace.readPause()
                                if (outcome.isEmpty()) outcome = "nothing found"
                            } else if (sSubmittedAt > 0 && now - sSubmittedAt > SEARCH_WAIT_MS) {
                                note("Statement: $label " + if (AppBanners.emptyList(texts)) "the list came up empty (bKash did not load it; decides nothing)" else "nothing came up"); sTarget = null
                                if (outcome.isEmpty()) outcome = if (AppBanners.emptyList(texts)) "list did not load" else "nothing came up"
                            } else if (sTypedAt > 0 && sSubmittedAt == 0L) {
                                if (now >= sTypedAt) {
                                    val box = searchBox(svc)
                                    val shown = box?.text?.toString()?.trim()?.uppercase(Locale.ROOT)
                                    if (shown != t.trx && sTypeTries < TYPE_WAYS.size - 1) {
                                        // The box did not keep what was typed (2026-11-11: only "D" or "DK" stayed when typed one
                                        // letter at a time): clear it and type again another way.
                                        sTypeTries++
                                        note("Statement: the search box shows ${shown?.take(4)?.ifEmpty { "nothing" } ?: "nothing"}…, typing $label again (${TYPE_WAYS[sTypeTries]})")
                                        sTypedAt = typeWay(svc, t.trx, now, main, sTypeTries); progressAt = now
                                    } else if (shown != t.trx) { note("Statement: the search box does not show $label, skipping it"); sTarget = null; if (outcome.isEmpty()) outcome = "could not type it" }
                                    else {
                                        val how = submitTry(svc, box, nodes, 0); sTries = 1
                                        note("Statement: searching $label ($how)")
                                        sSubmittedAt = now; progressAt = now; nextActAt = now + pace.settle()
                                    }
                                }
                            } else if (sTypedAt == 0L) {
                                val box = searchBox(svc)
                                val onStatements = texts.any { it.trim().lowercase(Locale.ROOT) in HISTORY }
                                when {
                                    box != null -> {
                                        note("Statement: typing $label (${TYPE_WAYS[sTypeTries]})")
                                        sTypedAt = typeWay(svc, t.trx, now, main, sTypeTries); progressAt = now
                                    }
                                    now - sStartedAt > BOX_WAIT_MS -> { note("Statement: the search box was not found"); if (outcome.isEmpty()) outcome = "search box not found"; return finish(true, null, "$searchWhy, Statement search not reached") }
                                    // On the Statement page but no box: the history tab first, then the box scrolled away with the list.
                                    onStatements && sTabs < 2 && pressAny(svc, HISTORY, root) -> { sTabs++; nextActAt = now + pace.settle(); progressAt = now }
                                    onStatements && sSwipes < 5 -> {
                                        if (sSwipes == 0) note("Statement: the search box is scrolled away, swiping back up")
                                        sSwipes++; progressAt = now; nextActAt = now + pace.readPause(); swipe(svc, up = false)
                                    }
                                    pressTab(svc, STATEMENT, root) -> { sTabs++; nextActAt = now + pace.settle(); progressAt = now; note("opened Statements") }
                                    // Not on a page with the Statements tab (a result page, a sheet, a sub-page): find the way back.
                                    now - progressAt > 3_000 && backs < MAX_WAY_BACK -> {
                                        backs++
                                        note("on a page without the Statements tab (${lastScreen.take(60)}): ${wayBack(svc, nodes, backs)}")
                                        progressAt = now; nextActAt = now + pace.settle()
                                    }
                                }
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
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
                                    // The box shows its hint only while it is empty (the box itself cannot be read).
                                    val hint = AppBanners.pinHint(texts)
                                    val shown = pinShown(root) ?: if (hint) 0 else null
                                    if (shown == null) pinBlind = true
                                    if (pinTyped == 0 && !keyPressed && shown != null && shown > 0)
                                        return finish(false, "pin_not_entered", "the PIN box already had ${shown} digit(s) in it; nothing typed, Log in NOT pressed")
                                    when (PinTyping.next(pinTyped, keys.size, shown, keyPressed, now - keyPressedAt, keyRetries)) {
                                        PinTyping.Step.PRESS -> if (canAct) {
                                            // Never type on top of digits already in the box: the hint must be showing.
                                            if (pinTyped == 0 && !hint && (retyping || texts.any { it == "লগ ইন" || it.equals("log in", ignoreCase = true) }))
                                                return finish(false, "pin_not_entered", "the PIN box was not empty (its hint is not showing); nothing typed, Log in NOT pressed")
                                            if (pinTyped == 0) note("login screen: typing the saved PIN slowly, one digit at a time")
                                            progressAt = now
                                            if (pressText(svc, keys[pinTyped])) { keyPressed = true; keyPressedAt = now; keyRetries = 0 }
                                            else return finish(false, "pin_not_entered", "a key of the app's keypad could not be pressed; Log in NOT pressed")
                                        }
                                        PinTyping.Step.WAIT -> {}
                                        PinTyping.Step.CONFIRMED -> {
                                            pinTyped++; keyPressed = false; progressAt = now
                                            if (pinTyped == keys.size) allTypedAt = now
                                            nextActAt = now + if (pinTyped == keys.size) pace.afterKeys() else pace.keyGap()
                                        }
                                        PinTyping.Step.RETRY -> {
                                            keyRetries++; keyPressedAt = now; progressAt = now
                                            note("digit ${pinTyped + 1} did not show in the box, pressing it again")
                                            pressText(svc, keys[pinTyped])
                                        }
                                        PinTyping.Step.LOGIN -> if (canAct) {
                                            // bKash keeps Log in grey until the whole PIN is in: grey here means a digit was lost.
                                            when (LoginGate.decide(buttonEnabled(nodes, LOGIN), now - allTypedAt)) {
                                                LoginGate.Step.WAIT -> {}
                                                LoginGate.Step.STOP -> return finish(false, "pin_not_entered",
                                                    "the Log in button stayed grey after ${keys.size} digits (one was lost); Log in NOT pressed")
                                                LoginGate.Step.PRESS -> {
                                                    note(if (pinBlind) "PIN typed slowly, the Log in button is lit, pressing it" else "the box shows all ${keys.size} digits, pressing Log in")
                                                    pinTypedAt = now; progressAt = now
                                                    if (!pressAny(svc, LOGIN)) note("login button not found")
                                                    nextActAt = now + pace.settle()
                                                }
                                            }
                                        }
                                        PinTyping.Step.STOP -> return finish(false, "pin_not_entered",
                                            "the PIN box showed ${shown} digit(s) after digit ${pinTyped + (if (keyPressed) 1 else 0)} of ${keys.size}; Log in NOT pressed")
                                    }
                                }
                            }
                            found.isNotEmpty() && !topped -> {
                                for ((key, at) in found) if (!rows.containsKey(key) && rows.size < MAX_ROWS) rows[key] = at
                                if (canAct) {
                                    val first = found.first().first
                                    when {
                                        topSwipes > 0 && first == topKey -> topped = true
                                        topSwipes >= TOP_SWIPES -> topped = true
                                        else -> { topKey = first; topSwipes++; progressAt = now; nextActAt = now + pace.readPause(); swipe(svc, up = false) }
                                    }
                                    if (topped) { note("at the newest end of the list (${topSwipes} swipe(s) up)"); prevFound = found.map { it.first }.toSet() }
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
                                if (oldest < cut) { wrapUp("reached the cut-off"); main.postDelayed(this, TICK_MS); return }
                                if (rows.size >= MAX_ROWS) { wrapUp("row limit"); main.postDelayed(this, TICK_MS); return }
                                if (canAct && pending.isNotEmpty()) {
                                    val hit = rowNodesOn(nodes).firstNotNullOfOrNull { (parts, at, node) ->
                                        pending.firstOrNull { t -> (tries[t.trx] ?: 0) < 2 && AppLook.matches(parts, t) }?.let { t -> Triple(t, at to parts, node) }
                                    }
                                    if (hit != null) {
                                        val (t, info, node) = hit
                                        tries[t.trx] = (tries[t.trx] ?: 0) + 1
                                        if ((tries[t.trx] ?: 0) >= 2) pending.remove(t)
                                        opening = t; openingAt = now; openingRowAt = info.first
                                        openingAmount = AppLook.amountOf(info.second) ?: t.amount
                                        openingParty = AppLook.partyOf(info.second)
                                        note("opening a row to read its TrxID")
                                        if (!tap(svc, node)) node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                        progressAt = now
                                        nextActAt = now + pace.settle()
                                        main.postDelayed(this, TICK_MS); return
                                    }
                                }
                                if (canAct) {
                                    if (added == 0) { if (graceScrolls > 0) graceScrolls-- else idleScrolls++ }
                                    if (idleScrolls >= 4) { wrapUp("end of the list"); main.postDelayed(this, TICK_MS); return }
                                    if (scrolls >= MAX_SCROLLS) { wrapUp("scroll limit"); main.postDelayed(this, TICK_MS); return }
                                    scrolls++
                                    nextActAt = now + pace.readPause()
                                    // A finger swipe; the list's own scroll only when swipes have stopped bringing new rows.
                                    if (idleScrolls >= 2 && scrollDown(svc, root)) note("scrolled by the list") else swipe(svc, up = true)
                                }
                            }
                            // Statement list first; the Inbox only when the Statement list shows nothing.
                            canAct && !useInbox && (AppBanners.emptyList(texts) || listPresses >= 4) -> {
                                useInbox = true; topped = false; topSwipes = 0; topKey = null
                                note("the Statement list " + (if (AppBanners.emptyList(texts)) "came up empty" else "did not load") + ", reading the Inbox instead")
                            }
                            canAct && !useInbox && pressAny(svc, HISTORY, root) -> { listPresses++; nextActAt = now + pace.settle(); note("opened the Statement list") }
                            canAct && !useInbox && pressTab(svc, STATEMENT, root) -> { listPresses++; nextActAt = now + pace.settle(); note("opened Statements") }
                            canAct && useInbox && pressAny(svc, TAB, root) -> { nextActAt = now + pace.settle(); note("opened the transactions tab") }
                            canAct && useInbox && pressTab(svc, INBOX, root) -> { nextActAt = now + pace.settle(); note("opened the inbox") }
                            else -> {
                                // Something left open over the app (a sheet, a sub-page, an offer): Back closes it and never
                                // confirms anything. Never on a screen with no words (the logo, the loading bird).
                                if (canAct && texts.isNotEmpty() && backs < MAX_WAY_BACK && now - progressAt > 3_000 + backs * 2_000L) {
                                    backs++
                                    note("a screen PayTrace does not know (${lastScreen.take(70)}): ${wayBack(svc, nodes, backs)}")
                                    nextActAt = now + pace.settle()
                                } else if (now - progressAt > STUCK_MS + backs * 3_000L) return finish(rows.isNotEmpty(), "unexpected_screen", "a screen PayTrace does not know")
                            }
                        }
                    }
                } catch (e: Exception) {
                    // A window that changed while being read; the next tick reads again.
                }
                main.postDelayed(this, TICK_MS)
            }
        }
        note("opening $pkg, reading back to ${cut}" + if (pending.isEmpty()) "" else ", ${pending.size} row(s) to open for their TrxID")
        launch()
        main.postDelayed(tick, pace.settle())
    }

    /** Keeps the screen on for the whole run: a screen that goes dark mid-run locks again and the app cannot be read. */
    @Suppress("DEPRECATION")
    internal fun holdScreen(app: Context, ms: Long, tag: String) {
        try {
            (app.getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "paytrace:$tag").acquire(ms)
        } catch (e: Exception) { }
    }

    /** Opens the bKash app. A phone that was asleep gets it through the wake window, which first pushes the swipe lock
     *  aside (the same way the USSD runs open the dialer); a phone already awake gets it straight away. */
    internal fun openBkash(svc: Context, app: Context, pkg: String, woke: Boolean, note: (String) -> Unit) {
        val open = app.packageManager.getLaunchIntentForPackage(pkg)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: return note("could not open the app")
        if (woke) {
            note("phone was asleep: opening the bKash app through the wake window")
            ScreenWake.wakeUp(svc, open)
        } else {
            // Whatever the person was doing on the phone is put aside first (owner 2026-11-11: "close or minimize
            // everything and enter the bKash app"): Home, then bKash. Nothing of theirs is closed or lost.
            val home = (svc as? AccessibilityService)?.let { s -> try { s.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { false } } == true
            val go = Runnable { try { svc.startActivity(open) } catch (e: Exception) { note("could not open the app") } }
            if (home) Handler(Looper.getMainLooper()).postDelayed(go, HOME_FIRST_MS) else go.run()
        }
    }

    internal fun bkashRoot(svc: AccessibilityService): AccessibilityNodeInfo? {
        svc.rootInActiveWindow?.let { if (AppRecorder.isBkash(it.packageName?.toString())) return it }
        return try { svc.windows.mapNotNull { it.root }.firstOrNull { AppRecorder.isBkash(it.packageName?.toString()) } } catch (e: Exception) { null }
    }

    /** How many digits the PIN box shows: the password box (or the box whose hint says PIN), never the account box.
     *  Null when there is no such box to read. Never reads WHICH digits (a password box only gives dots). */
    internal fun pinShown(root: AccessibilityNodeInfo): Int? {
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

    /** The Statement page's search box: the box being typed into, never a password box. */
    private fun searchBox(svc: AccessibilityService): AccessibilityNodeInfo? {
        val root = bkashRoot(svc) ?: return null
        var found: AccessibilityNodeInfo? = null
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || depth > 40 || found != null) return
            if (n.isEditable && !n.isPassword) { found = n; return }
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        walk(root, 0)
        return found
    }

    /** The ways the search box is filled, tried in turn until the box shows exactly the TrxID. */
    private val TYPE_WAYS = listOf("all at once", "pasted", "touched, then all at once", "letter by letter")

    private fun setText(svc: AccessibilityService, text: String) {
        searchBox(svc)?.let { b ->
            val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
            try { b.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args) } catch (e: Exception) { }
        }
    }

    /** Fills the search box with [text] the [way]-th way (see [TYPE_WAYS]), clearing it first. Returns when it will be done.
     *  Way 0 needs no keyboard: the 2026-11-11 tries that opened the keyboard and typed letter by letter kept only "D" or
     *  "DK" (the keyboard's own memory of the box wrote over the letters). */
    private fun typeWay(svc: AccessibilityService, text: String, now: Long, main: Handler, way: Int): Long {
        setText(svc, "")
        return when (way) {
            0 -> { main.postDelayed({ setText(svc, text) }, 400); now + 400 + BOX_SETTLE_MS }
            1 -> {
                // Through the phone's clipboard, the way a person pastes: the box takes it as its own input.
                try {
                    val cm = svc.getSystemService(Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("TrxID", text))
                } catch (e: Exception) { }
                main.postDelayed({
                    searchBox(svc)?.let { b ->
                        try { b.performAction(AccessibilityNodeInfo.ACTION_FOCUS) } catch (e: Exception) { }
                        try { b.performAction(AccessibilityNodeInfo.ACTION_PASTE) } catch (e: Exception) { }
                    }
                }, 400)
                now + 400 + BOX_SETTLE_MS
            }
            2 -> {
                searchBox(svc)?.let { b -> if (!tap(svc, b)) try { b.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { } }
                main.postDelayed({ setText(svc, text) }, BOX_TOUCH_MS)
                now + BOX_TOUCH_MS + BOX_SETTLE_MS
            }
            else -> {
                searchBox(svc)?.let { b -> if (!tap(svc, b)) try { b.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { } }
                var at = BOX_TOUCH_MS
                for (i in 1..text.length) {
                    at += pace.charGap()
                    val part = text.substring(0, i)
                    main.postDelayed({ setText(svc, part) }, at)
                }
                now + at + BOX_SETTLE_MS
            }
        }
    }

    /** One step back toward a page with the bottom tabs, from wherever the bKash app was left: the app's own Close / "Back
     *  to Home" / back arrow first, the phone's Back key last. None of these ever confirms anything. Says what it did. */
    private fun wayBack(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>, step: Int = 1): String {
        if (step % 2 == 0) { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK); return "pressed Back" }
        if (closeSheet(svc, nodes)) return "closed it"
        val home = nodes.firstOrNull { (it.text?.toString() ?: "").trim().lowercase(Locale.ROOT).let { t -> t in HOME_BACK } }
        if (home != null && pressNode(svc, home)) return "pressed its \"back to Home\" button"
        val arrow = nodes.firstOrNull { idEnds(it, "tag_toolbar_navigation_up") }
        if (arrow != null && pressNode(svc, arrow)) return "pressed its back arrow"
        svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
        return "pressed Back"
    }

    private fun pressNode(svc: AccessibilityService, n: AccessibilityNodeInfo): Boolean {
        var p: AccessibilityNodeInfo? = n
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) break; p = p.parent; hops++ }
        val target = p ?: n
        return tap(svc, target) || target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** A bottom tab ("Statements", "Inbox"): the LOWEST node with that word, so the page title of the same name is
     *  never pressed instead. */
    internal fun pressTab(svc: AccessibilityService, labels: Set<String>, root0: AccessibilityNodeInfo? = null): Boolean {
        val root = root0 ?: bkashRoot(svc) ?: return false
        val nodes = ArrayList<AccessibilityNodeInfo>()
        collect(root, nodes, 0)
        val hit = nodes.filter { it.text?.toString()?.trim()?.lowercase(Locale.ROOT) in labels }
            .maxByOrNull { n -> Rect().also { n.getBoundsInScreen(it) }.top } ?: return false
        return pressNode(svc, hit)
    }

    /** Presses Search, a different way on each try ([n] = 0, 1, 2), because one way may do nothing on this phone:
     *  0 = the page's Search button (tag_search_button) pressed directly; 1 = a finger tap on it; 2 = the keyboard's
     *  Search key (Android 11+). */
    private fun submitTry(svc: AccessibilityService, box: AccessibilityNodeInfo?, nodes: List<AccessibilityNodeInfo>, n: Int): String {
        val button = nodes.firstOrNull { idEnds(it, "tag_search_button") }
        if (n == 0 && button != null) {
            try { if (button.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return "Search button, pressed directly" } catch (e: Exception) { }
        }
        if (n <= 1 && button != null && tap(svc, button)) return "Search button, tapped"
        if (box != null && Build.VERSION.SDK_INT >= 30) {
            try { box.performAction(AccessibilityNodeInfo.ACTION_FOCUS) } catch (e: Exception) { }
            try { if (box.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) return "keyboard Search key" } catch (e: Exception) { }
        }
        if (button != null && tap(svc, button)) return "Search button, tapped"
        return if (pressAny(svc, SEARCH)) "Search button (by its word)" else "no way to press Search found"
    }

    private fun idEnds(n: AccessibilityNodeInfo, id: String) = (n.viewIdResourceName ?: "").endsWith(id)

    /** Whether the app has lit the button with these words (the tappable thing around them), or null when it is not on
     *  screen. bKash keeps Log in and Search grey until their box is filled. */
    internal fun buttonEnabled(nodes: List<AccessibilityNodeInfo>, labels: Set<String>): Boolean? {
        val hit = nodes.firstOrNull { it.text?.toString()?.trim()?.lowercase(Locale.ROOT) in labels } ?: return null
        var p: AccessibilityNodeInfo? = hit
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) return p.isEnabled; p = p.parent; hops++ }
        return null
    }

    /** Closes one of bKash's message strips by its own close button. */
    internal fun closeBanner(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>): Boolean {
        val c = nodes.firstOrNull { (it.contentDescription?.toString() ?: "").trim().equals("Close Button", ignoreCase = true) } ?: return false
        return tap(svc, c) || c.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** Closes the "change the agent status" sheet by its X (`tag_agent_cancel`), never by its "পরিবর্তন করুন" button. */
    internal fun closeAgentStatus(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>): Boolean {
        val c = nodes.firstOrNull { (it.viewIdResourceName ?: "").endsWith("tag_agent_cancel") }
            ?: nodes.firstOrNull { (it.contentDescription?.toString() ?: "").trim().equals("icon close", ignoreCase = true) }
            ?: return false
        return tap(svc, c) || c.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** Every node, skipping boxes being typed into. */
    internal fun collect(n: AccessibilityNodeInfo?, out: MutableList<AccessibilityNodeInfo>, depth: Int) {
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

    /** Like [rowsOn], with each row's words and its node (to open it). */
    private fun rowNodesOn(nodes: List<AccessibilityNodeInfo>): List<Triple<List<String>, Long, AccessibilityNodeInfo>> {
        val out = ArrayList<Triple<List<String>, Long, AccessibilityNodeInfo>>()
        for (n in nodes) {
            if (!n.isClickable || n.childCount == 0) continue
            val parts = ArrayList<String>()
            words(n, parts, 0)
            if (parts.size > 12 || !complete(parts)) continue
            val at = rowTime(parts) ?: continue
            out.add(Triple(parts, at, n))
        }
        return out
    }

    /** Closes a detail sheet by its close button ("শিট বন্ধ করুন" icon or the "বন্ধ করুন" text). */
    /** Closes an open bKash sheet (a transaction's details, a confirm sheet). The sheet's own Close button first, pressed
     *  directly and then by a finger: on 2026-11-11 a details sheet left open ignored taps on the dimmed area above it
     *  (the scrim), which is what used to be pressed first, and the run sat there until the owner closed it by hand. */
    private fun closeSheet(svc: AccessibilityService, nodes: List<AccessibilityNodeInfo>): Boolean {
        fun clickable(n: AccessibilityNodeInfo): AccessibilityNodeInfo {
            var p: AccessibilityNodeInfo? = n
            var hops = 0
            while (p != null && hops < 4) { if (p.isClickable) return p; p = p.parent; hops++ }
            return n
        }
        val button = nodes.firstOrNull { idEnds(it, "transaction_details_close_button") }
            ?: nodes.firstOrNull { (it.text?.toString() ?: "").trim().lowercase(Locale.ROOT) in setOf("বন্ধ করুন", "close") }?.let { clickable(it) }
        if (button != null) {
            val pressed = try { button.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }
            if (pressed || tap(svc, button)) return true
        }
        val scrim = nodes.firstOrNull { n ->
            val d = (n.contentDescription?.toString() ?: "").lowercase(Locale.ROOT)
            "শিট বন্ধ" in d || d == "close" || "close sheet" in d
        } ?: return false
        val target = clickable(scrim)
        return (try { target.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }) || tap(svc, target)
    }

    /** A transaction's details sheet is open (opened by a read or a search, or left by a person). */
    private fun detailsOpen(nodes: List<AccessibilityNodeInfo>): Boolean = nodes.any { idEnds(it, "transaction_details_title") || idEnds(it, "transaction_details_close_button") }

    internal fun words(n: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
        if (n == null || depth > 8 || n.isPassword || n.isEditable) return
        n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add(it.replace('\n', ' ').replace(" | ", " / ")) }
        for (i in 0 until n.childCount) words(n.getChild(i), out, depth + 1)
    }

    /** Presses the node whose whole text is [label] (or the nearest tappable thing around it). */
    internal fun pressText(svc: AccessibilityService, label: String): Boolean = pressAny(svc, setOf(label))

    internal fun pressAny(svc: AccessibilityService, labels: Set<String>, root0: AccessibilityNodeInfo? = null): Boolean {
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

    internal fun tap(svc: AccessibilityService, node: AccessibilityNodeInfo): Boolean {
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
    /** Between PIN digits, after the box has shown the last one (owner 2026-11-10: the app lagged at 0.3-0.65 s with no check;
     *  owner 2026-11-11: 0.8-1.4 s + 1.6 s per blind digit was "slower than a human", so 0.45-0.8 s + 0.9 s; the lit Log in
     *  button still decides). */
    fun keyGap(): Long = between(450L, 800L)
    fun afterKeys(): Long = between(700L, 1_100L)
    fun settle(): Long = between(1_800L, 3_200L)
    fun readPause(): Long = between(1_300L, 2_600L)
    fun tapMs(): Long = between(55L, 120L)
    /** A slow drag (the first Vivo read, build 173, used 0.4-0.7 s swipes: the list flung past 3 of 78 rows). */
    fun swipeMs(): Long = between(600L, 1_000L)
    /** One character of a number or amount typed into a box (app cash-in). */
    fun charGap(): Long = between(140L, 320L)
    /** The bKash app's "tap and hold" to send: held a little longer than the app needs, never a quick tap. */
    fun holdPressMs(): Long = between(3_000L, 4_000L)
    /** The finger stays still this long before lifting, so the list stops where the finger stopped (no fling). */
    fun holdMs(): Long = between(220L, 380L)
    /** A point in the middle part of a box (30% to 70% across and down), never its edge. */
    fun pointIn(left: Int, top: Int, right: Int, bottom: Int): Pair<Float, Float> =
        (left + (right - left) * between(0.3, 0.7)).toFloat() to (top + (bottom - top) * between(0.3, 0.7)).toFloat()
    /** A swipe up the screen as fractions of its size: x, start y, end y (about a third of the screen, so every row is
     *  seen whole at least once). */
    fun swipe(): DoubleArray = doubleArrayOf(between(0.42, 0.58), between(0.70, 0.78), between(0.36, 0.44))
}

/** bKash's own messages and states, as the owner's recording of 2026-11-10 showed them (run a1460479). Bangla letters can
 *  be stored two ways, so both sides are compared in one form. Pure, unit tested. */
object AppBanners {
    private fun n(s: String): String = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD).lowercase(Locale.ROOT)
    private fun has(texts: List<String>, vararg parts: String): Boolean = texts.any { t -> val s = n(t); parts.all { n(it) in s } }

    /** "পিন নাম্বারটি সঠিক নয়": the PIN was refused. */
    fun wrongPin(texts: List<String>): Boolean = has(texts, "পিন", "সঠিক নয়") || has(texts, "pin", "incorrect") || has(texts, "wrong pin")
    /** "অনুগ্রহ করে আপনার নেটওয়ার্ক চেক করুন": the app could not reach bKash. */
    fun network(texts: List<String>): Boolean = has(texts, "নেটওয়ার্ক চেক") || has(texts, "check", "network")
    /** The login screen's PIN box shows "এজেন্ট পিন নাম্বার দিন" only while it is empty. */
    fun pinHint(texts: List<String>): Boolean = has(texts, "পিন নাম্বার দিন") || texts.any { it.trim().equals("agent pin", ignoreCase = true) }
    /** A list that did not load says "আপনি সম্প্রতি কোনো লেনদেন সম্পন্ন করেন নি"; it says nothing about any payment. */
    fun emptyList(texts: List<String>): Boolean = has(texts, "সম্প্রতি", "লেনদেন", "করেন নি") || has(texts, "haven't made any transactions")
    /** The sheet "স্ট্যাটাস পরিবর্তন করুন / আপনার এজেন্ট অ্যাপের বর্তমান স্ট্যাটাসটি CLOSE রয়েছে ..." (recorder run 65408217,
     *  2026-11-11): bKash asks after login to switch the agent's shop status. It is closed with its X; the status is the
     *  owner's business and is never changed by PayTrace (its "পরিবর্তন করুন" button is never pressed). */
    fun agentStatus(texts: List<String>): Boolean =
        has(texts, "স্ট্যাটাস পরিবর্তন করুন") || has(texts, "এজেন্ট অ্যাপের", "স্ট্যাটাস") || has(texts, "change", "agent", "status")
}

/** Pressing Log in only when bKash has lit the button: it stays grey until the whole PIN is in, so a grey button after
 *  the last digit means a digit was lost and nothing may be pressed. Pure, unit tested. */
object LoginGate {
    enum class Step { PRESS, WAIT, STOP }
    const val GREY_MS = 4_000L
    /** [enabled] = the button is lit (null = cannot tell: an older app, press as before); [waitedMs] since the last digit. */
    fun decide(enabled: Boolean?, waitedMs: Long): Step = when {
        enabled != false -> Step.PRESS
        waitedMs < GREY_MS -> Step.WAIT
        else -> Step.STOP
    }
}

/** Typing a PIN on an app's own keypad one checked digit at a time. Pure, unit tested. */
object PinTyping {
    enum class Step { PRESS, WAIT, CONFIRMED, RETRY, LOGIN, STOP }

    /** A digit not shown after this long is pressed again (at most [RETRIES] times); with no box to read, a digit
     *  counts as typed after [BLIND_MS]. */
    const val SHOW_MS = 1_800L
    const val BLIND_MS = 900L
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

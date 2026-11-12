package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/** Reading the bKash balance on the bKash Agent app's Home (owner 2026-11-11: "yes build balance check in app"). From the
 *  owner's recordings 573a9296 and 41cae20d (bKash Business 3.10.2, Vivo): Home has `tag_tap_for_balance` ("Tap for Balance",
 *  a view described "tap for balance"); after a tap the figure appears in `tag_balance_amount` ("11,923.83", no ৳) for a few
 *  seconds and then hides again; the next tap fetches it again (11,674.77 after a Tk 250 Cash In with 0.94 commission).
 *  Pure, so every rule is unit tested. */
object AppBalanceRead {
    const val TAP_ID = "tag_tap_for_balance"
    const val AMOUNT_ID = "tag_balance_amount"
    private val BN = "০১২৩৪৫৬৭৮৯"
    private val FIGURE = Regex("^৳?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)$")

    /** "11,923.83", "৳ 11,923.83" or the same in Bangla digits → 11923.83; anything else (the "Tap for Balance" words, a
     *  half-drawn figure) → null. */
    fun amount(text: String?): Double? {
        val t = (text ?: "").trim().map { c -> BN.indexOf(c).let { if (it >= 0) ('0' + it) else c } }.joinToString("")
        val m = FIGURE.find(t) ?: return null
        val v = m.groupValues[1].replace(",", "").toDoubleOrNull() ?: return null
        return if (v in 0.0..10_000_000.0) v else null
    }

    /** Home is the page with the balance pill. */
    fun isHome(ids: List<String>): Boolean = ids.any { it.endsWith(TAP_ID) }

    /** The figure on screen, from the amount view only (never a transaction row's "- ৳250"). */
    fun shown(idTexts: List<Pair<String, String?>>): Double? =
        idTexts.firstOrNull { it.first.endsWith(AMOUNT_ID) }?.let { amount(it.second) }

    /** What to do on Home. [visible] = a figure is showing now; [tapped] = PayTrace tapped [sinceTap] ms ago, [taps] times;
     *  [onHome] = ms since Home first showed. A figure that was already showing before PayTrace's own tap is waited out
     *  (someone else's tap, maybe minutes old), but after [STALE_WAIT_MS] it is taken as it is, with a note. */
    enum class Step { TAP, WAIT, READ, READ_OLD, GIVE_UP }
    const val STALE_WAIT_MS = 10_000L
    const val SHOW_WAIT_MS = 8_000L
    const val TAPS = 3
    fun next(visible: Boolean, tapped: Boolean, sinceTap: Long, taps: Int, onHome: Long): Step = when {
        tapped && visible -> Step.READ
        !tapped && visible -> if (onHome >= STALE_WAIT_MS) Step.READ_OLD else Step.WAIT
        !tapped -> Step.TAP
        sinceTap < SHOW_WAIT_MS -> Step.WAIT
        taps < TAPS -> Step.TAP
        else -> Step.GIVE_UP
    }
}

/** A bKash balance check through the bKash APP instead of *247# (migration 089: the dashboard chose `via = app`). Only reads,
 *  nothing is sent. Same gates and pace as the app reader: wakes the phone, opens bKash, logs in with the PIN one checked
 *  digit at a time, closes the "agent status" sheet with its X (reading needs no OPEN status), taps "Tap for Balance" with a
 *  finger and reads the figure. Never types the PIN twice. */
object AppBalance {
    const val RUN_MS = 120_000L
    private const val TICK_MS = 700L
    private const val STUCK_MS = 25_000L
    private const val LOGIN_WAIT_MS = 15_000L

    @Volatile internal var running = false

    fun start(ctx: Context, provider: String, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        fun fail(e: String) = done(UssdOutcome(false, null, e))
        if (provider != UssdProviders.BKASH) return fail("unsupported")
        if (!s.ussdAllowed) return fail("not_allowed")
        val svc = UssdSession.launchContext() as? AccessibilityService ?: return fail("accessibility_not_running")
        if (running || AppReader.active() || UssdSession.active() || UssdApi.active()) return fail("busy")
        val keys = AppReader.pinKeys(UssdSetup.pinStore(app, UssdProviders.BKASH).get()) ?: return fail("no_pin")
        val pkg = AppRecorder.findApp(app) ?: return fail("no_bkash_app")
        val woke = when (ScreenWake.state(app)) {
            ScreenGate.State.LOCKED_SECURE -> return fail("phone_locked")
            ScreenGate.State.WAKE_NEEDED -> true
            ScreenGate.State.READY -> false
        }
        running = true
        val pace = AppReader.pace
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        val trace = ArrayList<String>()
        fun note(t: String) { if (trace.size < 40) trace.add(String.format(Locale.US, "%5.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, t)) }

        var finished = false
        var seenApp = 0L
        var nextActAt = 0L
        var progressAt = started
        var screenText = ""
        var typed = 0; var pressed = false; var pressedAt = 0L; var retries = 0; var submittedAt = 0L
        var homeAt = 0L
        var tapped = false; var tapAt = 0L; var taps = 0
        var statusHits = 0
        var backs = 0
        var banners = 0
        var sawWalletError = false
        var reopens = 0

        fun finish(o: UssdOutcome, why: String) {
            if (finished) return
            finished = true
            running = false
            note("end: $why")
            val log = (trace + "screen: $screenText").joinToString("\n").take(1900)
            done(o.copy(trace = log))
        }
        fun stop(error: String, why: String) = finish(UssdOutcome(false, null, error), why)

        AppReader.holdScreen(app, RUN_MS + 5_000, "appbalance")

        val tick = object : Runnable {
            override fun run() {
                if (finished) return
                val now = SystemClock.elapsedRealtime()
                if (now - started > RUN_MS) return stop(if (homeAt > 0) "balance_not_shown" else "app_closed", "time limit")
                try {
                    val root = AppReader.bkashRoot(svc)
                    if (root == null) {
                        if (seenApp == 0L && OpenRetry.due(false, now - started, reopens)) { reopens++; note("the app is not on screen yet: opening it again ($reopens)"); AppReader.openBkash(svc, app, pkg, woke) { note(it) } }
                        if (seenApp == 0L && now - started > OpenRetry.GIVE_UP_MS) return stop("app_not_opened", "the app did not open")
                        if (seenApp > 0 && now - seenApp > 20_000) return stop("app_closed", "the app left the screen")
                    } else {
                        if (seenApp == 0L) nextActAt = now + pace.settle()
                        seenApp = now
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        AppReader.collect(root, nodes, 0)
                        val texts = nodes.mapNotNull { n -> n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } }
                        val ids = nodes.map { it.viewIdResourceName ?: "" }
                        screenText = AppRecorder.safeLines(texts).joinToString(" / ").take(600)
                        val canAct = now >= nextActAt
                        val keypad = (0..9).all { d -> texts.any { it == d.toString() } }

                        if (AppBanners.wrongPin(texts)) return stop("login_failed", "bKash says the PIN is not correct; never typed again")
                        if (AppBanners.appError(texts) || AppBanners.network(texts)) sawWalletError = true
                        if (AppBanners.network(texts)) {
                            if (canAct) {
                                if (++banners > 3) return stop("no_network", "bKash keeps saying: check your network")
                                note("bKash says: check your network; closing it and waiting")
                                AppReader.closeBanner(svc, nodes)
                                nextActAt = now + 4_000
                            }
                            main.postDelayed(this, TICK_MS); return
                        }
                        if (AppBanners.agentStatus(texts)) {
                            // Reading needs no OPEN status, so the sheet is only closed with its X (like the app read).
                            if (canAct) {
                                if (++statusHits > 3) return stop("unexpected_screen", "bKash keeps showing the agent status sheet")
                                note("closing bKash's agent status sheet with its X")
                                if (!AppReader.closeAgentStatus(svc, nodes)) svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                                progressAt = now
                                nextActAt = now + pace.settle()
                            }
                            main.postDelayed(this, TICK_MS); return
                        }

                        if (AppBalanceRead.isHome(ids)) {
                            if (homeAt == 0L) { homeAt = now; progressAt = now; note("home") }
                            val value = AppBalanceRead.shown(nodes.map { (it.viewIdResourceName ?: "") to it.text?.toString() })
                            when (AppBalanceRead.next(value != null, tapped, now - tapAt, taps, now - homeAt)) {
                                AppBalanceRead.Step.READ, AppBalanceRead.Step.READ_OLD -> {
                                    val old = !tapped
                                    note(if (old) "the balance was already showing and did not hide: taking it as it is" else "the balance shows")
                                    main.postDelayed({ svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) }, pace.readPause())
                                    val summary = "bKash app balance\nbalance: $value" + (if (old) "\nNOTE: it was already showing before PayTrace tapped" else "")
                                    return finish(UssdOutcome(true, value, null, screens = listOf(summary)), "done")
                                }
                                AppBalanceRead.Step.TAP -> if (canAct) {
                                    val pill = nodes.firstOrNull { (it.viewIdResourceName ?: "").endsWith(AppBalanceRead.TAP_ID) }
                                    if (pill == null) { nextActAt = now + 1_000 } else {
                                        taps++; tapped = true; tapAt = now; progressAt = now
                                        note(if (taps == 1) "tapping Tap for Balance" else "no figure yet: tapping Tap for Balance again ($taps)")
                                        if (!AppReader.tap(svc, pill)) pill.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                                        nextActAt = now + pace.settle()
                                    }
                                }
                                AppBalanceRead.Step.WAIT -> {}
                                AppBalanceRead.Step.GIVE_UP -> return stop("balance_not_shown", "the balance did not show after $taps taps")
                            }
                        } else if (keypad && AppCashInRead.screenOf(texts, keypad) == AppCashInRead.Screen.LOGIN) {
                            progressAt = now
                            if (submittedAt > 0) {
                                if (now - submittedAt > LOGIN_WAIT_MS) return stop(LoginTrouble.stuck(sawWalletError), "still on the login screen after the PIN" + if (sawWalletError) " (bKash showed its own error: not a wrong PIN)" else "")
                            } else {
                                val shown = AppReader.pinShown(root)
                                if (typed == 0 && !pressed && shown != null && shown > 0) return stop("pin_not_entered", "the PIN box already had digits in it; nothing typed")
                                if (typed == keys.size && !pressed) {
                                    when (LoginGate.decide(AppReader.buttonEnabled(nodes, AppReader.LOGIN), now - pressedAt - PinTyping.BLIND_MS)) {
                                        LoginGate.Step.WAIT -> { main.postDelayed(this, TICK_MS); return }
                                        LoginGate.Step.STOP -> return stop("pin_not_entered", "the Log in button stayed grey after the PIN (a digit was lost); Log in NOT pressed")
                                        LoginGate.Step.PRESS -> {}
                                    }
                                }
                                when (PinTyping.next(typed, keys.size, shown, pressed, now - pressedAt, retries)) {
                                    PinTyping.Step.PRESS -> if (canAct) {
                                        if (typed == 0) note("login PIN: typing slowly, one digit at a time")
                                        if (AppReader.pressText(svc, keys[typed])) { pressed = true; pressedAt = now; retries = 0 }
                                        else return stop("pin_not_entered", "a key of the app's keypad could not be pressed")
                                    }
                                    PinTyping.Step.WAIT -> {}
                                    PinTyping.Step.CONFIRMED -> {
                                        typed++; pressed = false
                                        nextActAt = now + if (typed == keys.size) pace.afterKeys() else pace.keyGap()
                                    }
                                    PinTyping.Step.RETRY -> {
                                        retries++; pressedAt = now
                                        note("PIN digit ${typed + 1} did not show, pressing it again")
                                        AppReader.pressText(svc, keys[typed])
                                    }
                                    PinTyping.Step.LOGIN -> if (canAct) {
                                        note("the PIN box shows all ${keys.size} digits, pressing Log in")
                                        submittedAt = now
                                        if (!AppReader.pressAny(svc, AppReader.LOGIN)) note("Log in not found")
                                        nextActAt = now + pace.settle()
                                    }
                                    PinTyping.Step.STOP -> return stop("pin_not_entered", "the PIN box showed the wrong number of digits; Log in NOT pressed")
                                }
                            }
                        } else if (texts.isNotEmpty() && canAct && now - progressAt > 8_000 && backs < 4) {
                            // A page or sheet left open (Back never confirms anything); a screen with no words is a splash.
                            backs++
                            note("a screen PayTrace does not know: going back")
                            svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                            progressAt = now
                            nextActAt = now + pace.settle()
                        } else if (now - progressAt > STUCK_MS) {
                            return stop("unexpected_screen", "a screen PayTrace does not know")
                        }
                    }
                } catch (e: Exception) {
                    // A window that changed while being read; the next tick reads again.
                }
                main.postDelayed(this, TICK_MS)
            }
        }
        note("opening $pkg: reading the bKash balance")
        AppReader.openBkash(svc, app, pkg, woke) { note(it) }
        main.postDelayed(tick, pace.settle())
    }
}

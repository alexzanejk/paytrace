package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/** Closing a wallet app fully when a task is stuck (owner 2026-11-19: "if it gets stuck anywhere it should close the app
 *  fully and re-enter, not just minimise it"). No app can force-stop another app directly; what PayTrace can do is (1) put
 *  the app in the background and ask Android to end its process (works up to Android 13), then (2) open Android's own
 *  app-info page for the wallet app, press its "Force stop" button and the confirm, as a person would. Afterwards the task
 *  opens the app again from the start ([AppRestart]). The button names differ a little per brand, so the log says what was
 *  on the page when none was found. Never more than one at a time, and not twice within [AGAIN_MS] on one phone. */
object ForceStop {
    /** The button on the app-info page, lower case; Bangla from Android's own translation. */
    val BUTTON = setOf("force stop", "force close", "force-stop", "জোর করে বন্ধ করুন", "জোর করে থামান", "বলপূর্বক বন্ধ করুন", "জোরপূর্বক বন্ধ করুন")
    /** The confirm button of the "Force stop?" dialog. */
    val CONFIRM = setOf("ok", "force stop", "yes", "stop", "ঠিক আছে", "হ্যাঁ", "বন্ধ করুন", "জোর করে বন্ধ করুন")
    const val TIMEOUT_MS = 15_000L
    /** One full close per task is the rule; this only stops two tasks closing the same app back to back. */
    const val AGAIN_MS = 20_000L
    private const val TICK_MS = 500L
    @Volatile private var lastAt = 0L
    @Volatile var running = false; private set

    /** Pure, unit tested: the text to press on a page of [texts] (lower-cased by the caller), for the button and then the
     *  confirm. A disabled "Force stop" (the app is not running) is still "found": the caller treats it as already stopped. */
    fun pickButton(texts: List<String>): String? = texts.firstOrNull { it in BUTTON }
    fun pickConfirm(texts: List<String>): String? =
        texts.firstOrNull { it == "force stop" || it == "জোর করে বন্ধ করুন" } ?: texts.firstOrNull { it in CONFIRM }

    /** May a task force-stop the app now? Not twice within [AGAIN_MS] on this phone, and not while one is under way. */
    fun canTry(): Boolean = !running && SystemClock.elapsedRealtime() - lastAt > AGAIN_MS

    /** Closes [pkg] fully: Home, Android asked to end its process, then the app-info page's Force stop and its confirm,
     *  then Home again, then [done] (true = closed, or it was not running). The touch freeze stays up throughout when the
     *  phone has it on; the caller lowers it. */
    fun start(svc: AccessibilityService, pkg: String, note: (String) -> Unit, done: (Boolean) -> Unit) {
        if (running) return done(false)
        running = true
        lastAt = SystemClock.elapsedRealtime()
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        var phase = 0            // 0 = looking for Force stop, 1 = looking for the confirm, 2 = done
        var pressedAt = 0L
        var lastPage = ""
        TaskShield.raise(svc, "closing the ${pkg.substringAfterLast('.')} app fully")
        fun finish(ok: Boolean, why: String) {
            if (!running) return
            running = false
            note("full close of ${pkg.substringAfterLast('.')}: $why")
            try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { }
            main.postDelayed({ done(ok) }, 900)
        }
        // Step 1: out of the way, and Android asked to end the process (a no-op for other apps from Android 14 on).
        TaskGuard.clearScreen(svc)
        try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { }
        if (Build.VERSION.SDK_INT < 34) {
            try { (svc.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).killBackgroundProcesses(pkg); note("asked Android to end the app's process") } catch (e: Exception) { }
        }
        // Step 2: the app-info page's own Force stop, which works on every Android.
        main.postDelayed({
            try {
                svc.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
            } catch (e: Exception) { return@postDelayed finish(false, "the app-info page could not be opened") }
            val tick = object : Runnable {
                override fun run() {
                    if (!running) return
                    val now = SystemClock.elapsedRealtime()
                    if (now - started > TIMEOUT_MS) return finish(false, "no Force stop button found in 15 s (page: ${lastPage.take(120)})")
                    try {
                        val roots = try { svc.windows.mapNotNull { it.root } } catch (e: Exception) { emptyList() } + listOfNotNull(svc.rootInActiveWindow)
                        val settings = roots.filter { r -> (r.packageName?.toString() ?: "").let { it != svc.packageName && !AppRecorder.isBkash(it) && !NagadRead.isNagad(it) } }
                        val nodes = ArrayList<AccessibilityNodeInfo>()
                        settings.forEach { AppReader.collect(it, nodes, 0) }
                        fun labelOf(n: AccessibilityNodeInfo): String? =
                            (n.text?.toString()?.trim()?.takeIf { it.isNotEmpty() } ?: n.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() })?.lowercase(Locale.ROOT)
                        val texts = nodes.mapNotNull { labelOf(it) }
                        if (texts.isNotEmpty()) lastPage = texts.joinToString(" / ")
                        when (phase) {
                            0 -> {
                                val label = pickButton(texts)
                                if (label == null) { main.postDelayed(this, TICK_MS); return }
                                val node = nodes.first { labelOf(it) == label }
                                if (!node.isEnabled) return finish(true, "the app was not running (Force stop is grey)")
                                if (press(svc, node)) { phase = 1; pressedAt = now; note("pressed \"${label}\" on the app-info page") }
                            }
                            1 -> {
                                val label = pickConfirm(texts)
                                if (label != null && now - pressedAt > 400) {
                                    val node = nodes.firstOrNull { labelOf(it) == label && it.isEnabled }
                                    if (node != null && press(svc, node)) return finish(true, "confirmed \"${label}\"")
                                }
                                if (now - pressedAt > 6_000) return finish(true, "no confirm asked")
                            }
                        }
                    } catch (e: Exception) { }
                    main.postDelayed(this, TICK_MS)
                }
            }
            main.postDelayed(tick, 1_200)
        }, 700)
    }

    private fun press(svc: AccessibilityService, n: AccessibilityNodeInfo): Boolean {
        var p: AccessibilityNodeInfo? = n
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) break; p = p.parent; hops++ }
        val target = p ?: n
        return (try { target.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }) || AppReader.tap(svc, target)
    }
}

/** What happens after an app run ends badly (owner 2026-11-19: "if it gets stuck anywhere, close the app fully and start
 *  over"). A run that stops with [CODE] (stuck before any money step) is force-stopped and started again ONCE, both halves
 *  in one log. A run that stops with any ending in [CLOSE_AFTER] (stuck or cut off, but a step that may have moved money
 *  had begun, or it already is the second try) is reported as it is and the app is then force-stopped in the background,
 *  so the next task starts from a clean app instead of a leftover screen; it is never started again by itself. */
object AppRestart {
    const val CODE = "app_restart"
    /** Endings after which the app is closed fully (without a second try). */
    val CLOSE_AFTER = setOf("unexpected_screen", "app_not_opened", "app_closed", "app_stopped_before_send", "no_answer_after_hold",
        "no_answer_after_confirm", "app_error", "no_network", "login_failed", "pin_not_entered", "secure_keyboard")

    enum class Step { RESTART, CLOSE, NONE }

    /** Pure, unit tested. [canTry] = [ForceStop.canTry]; [secondRun] = this outcome is already the second try. */
    fun plan(error: String?, canTry: Boolean, secondRun: Boolean): Step = when {
        error == null || !canTry -> Step.NONE
        error == CODE && !secondRun -> Step.RESTART
        error == CODE || error in CLOSE_AFTER -> Step.CLOSE
        else -> Step.NONE
    }

    /** The code the dashboard sees: a stuck run that was not (or not again) started over reads as the usual stuck ending. */
    fun reported(o: UssdOutcome): UssdOutcome = if (o.error == CODE) o.copy(error = "unexpected_screen") else o

    fun run(svc: AccessibilityService?, pkgOf: () -> String?, launch: ((UssdOutcome) -> Unit) -> Unit, back: (UssdOutcome) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        fun attempt(second: Boolean, prefix: String) {
            launch { o ->
                val pkg = pkgOf()
                val step = if (svc == null || pkg == null) Step.NONE else plan(o.error, ForceStop.canTry(), second)
                fun withPrefix(x: UssdOutcome) = if (prefix.isEmpty()) x else x.copy(trace = (prefix + "\n" + x.trace).take(1900))
                when (step) {
                    Step.NONE -> { TaskShield.lower(); back(withPrefix(reported(o))) }
                    Step.CLOSE -> {
                        // Reported first (the server's clock is running), closed afterwards.
                        back(withPrefix(reported(o).copy(trace = (o.trace + "\nclosing the app fully after this, so the next task starts clean").take(1900))))
                        ForceStop.start(svc!!, pkg!!, { }) { TaskShield.lower() }
                    }
                    Step.RESTART -> {
                        val notes = ArrayList<String>()
                        ForceStop.start(svc!!, pkg!!, { notes.add(it) }) { ok ->
                            if (!ok) { TaskShield.lower(); return@start back(withPrefix(reported(o).copy(trace = (o.trace + "\n" + notes.joinToString("\n")).take(1900)))) }
                            main.postDelayed({
                                attempt(true, (prefix + (if (prefix.isEmpty()) "" else "\n") + o.trace + "\n" + notes.joinToString("\n") + "\n-- the app was closed fully and opened again --").take(1200))
                            }, 1_500)
                        }
                    }
                }
            }
        }
        attempt(false, "")
    }
}

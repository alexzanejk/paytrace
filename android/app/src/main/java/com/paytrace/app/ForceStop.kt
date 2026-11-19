package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityNodeInfo
import java.util.Locale

/** Closing a wallet app fully when a task is stuck on a screen PayTrace does not know (owner 2026-11-19: "if it gets stuck
 *  anywhere it should close the app fully and re-enter"). No app can force-stop another app directly; what PayTrace can do
 *  is open Android's own app-info page for the wallet app, press its "Force stop" button and the confirm, as a person
 *  would, then the task opens the app again from the start. Used only BEFORE any PIN was typed, at most once per task
 *  ([AppRestart]), and never more than once every [AGAIN_MS] per phone. The button names differ a little per brand, so the
 *  log says what was on the page when none was found. */
object ForceStop {
    /** The button on the app-info page, lower case; Bangla from Android's own translation. */
    val BUTTON = setOf("force stop", "force close", "force-stop", "জোর করে বন্ধ করুন", "জোর করে থামান", "বলপূর্বক বন্ধ করুন")
    /** The confirm button of the "Force stop?" dialog. */
    val CONFIRM = setOf("ok", "force stop", "yes", "stop", "ঠিক আছে", "হ্যাঁ", "বন্ধ করুন", "জোর করে বন্ধ করুন")
    const val TIMEOUT_MS = 15_000L
    const val AGAIN_MS = 120_000L
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

    /** Opens the app-info page of [pkg], presses Force stop and its confirm, goes Home, then [done] (true = pressed). */
    fun start(svc: AccessibilityService, pkg: String, note: (String) -> Unit, done: (Boolean) -> Unit) {
        if (running) return done(false)
        running = true
        lastAt = SystemClock.elapsedRealtime()
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        var phase = 0            // 0 = looking for Force stop, 1 = looking for the confirm, 2 = done
        var pressedAt = 0L
        var lastPage = ""
        fun finish(ok: Boolean, why: String) {
            if (!running) return
            running = false
            note("force stop of ${pkg.substringAfterLast('.')}: $why")
            try { svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { }
            main.postDelayed({ done(ok) }, 900)
        }
        try {
            svc.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        } catch (e: Exception) { return finish(false, "the app-info page could not be opened") }
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
                    val texts = nodes.mapNotNull { it.text?.toString()?.trim()?.lowercase(Locale.ROOT)?.takeIf { t -> t.isNotEmpty() } }
                    if (texts.isNotEmpty()) lastPage = texts.joinToString(" / ")
                    when (phase) {
                        0 -> {
                            val label = pickButton(texts) ?: return main.postDelayed(this, TICK_MS)
                            val node = nodes.first { it.text?.toString()?.trim()?.lowercase(Locale.ROOT) == label }
                            if (!node.isEnabled) return finish(true, "the app was not running (Force stop is grey)")
                            if (press(svc, node)) { phase = 1; pressedAt = now; note("pressed \"${node.text}\" on the app-info page") }
                        }
                        1 -> {
                            val label = pickConfirm(texts)
                            if (label != null && now - pressedAt > 400) {
                                val node = nodes.firstOrNull { it.text?.toString()?.trim()?.lowercase(Locale.ROOT) == label && it.isEnabled }
                                if (node != null && press(svc, node)) return finish(true, "confirmed \"${node.text}\"")
                            }
                            if (now - pressedAt > 6_000) return finish(true, "no confirm asked")
                        }
                    }
                } catch (e: Exception) { }
                main.postDelayed(this, TICK_MS)
            }
        }
        main.postDelayed(tick, 1_200)
    }

    private fun press(svc: AccessibilityService, n: AccessibilityNodeInfo): Boolean {
        var p: AccessibilityNodeInfo? = n
        var hops = 0
        while (p != null && hops < 4) { if (p.isClickable) break; p = p.parent; hops++ }
        val target = p ?: n
        return (try { target.performAction(AccessibilityNodeInfo.ACTION_CLICK) } catch (e: Exception) { false }) || AppReader.tap(svc, target)
    }
}

/** One task, two tries: when an app run stops as `app_restart` (stuck on a screen it does not know, before any PIN), the
 *  wallet app is force-stopped and the same run started again once; its log carries both halves. A second `app_restart`
 *  is reported as `unexpected_screen`, as before. */
object AppRestart {
    const val CODE = "app_restart"

    fun run(svc: AccessibilityService?, pkgOf: () -> String?, launch: ((UssdOutcome) -> Unit) -> Unit, back: (UssdOutcome) -> Unit) {
        launch { first ->
            val pkg = pkgOf()
            if (first.error != CODE || svc == null || pkg == null || !ForceStop.canTry()) {
                return@launch back(if (first.error == CODE) first.copy(error = "unexpected_screen") else first)
            }
            val notes = ArrayList<String>()
            ForceStop.start(svc, pkg, { notes.add(it) }) { ok ->
                if (!ok) return@start back(first.copy(error = "unexpected_screen", trace = (first.trace + "\n" + notes.joinToString("\n")).take(1900)))
                Handler(Looper.getMainLooper()).postDelayed({
                    launch { second ->
                        val o = if (second.error == CODE) second.copy(error = "unexpected_screen") else second
                        back(o.copy(trace = (first.trace + "\n" + notes.joinToString("\n") + "\n-- the app was closed fully and opened again --\n" + o.trace).take(1900)))
                    }
                }, 1_500)
            }
        }
    }
}

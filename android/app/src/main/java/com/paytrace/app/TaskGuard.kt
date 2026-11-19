package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.os.Build

/** Keeping a dashboard task's own screen in front until the task is over (owner 2026-11-19: "when I push a task from the
 *  dashboard, whether app or USSD, it should force away anything else on the phone screen until the task is completed,
 *  and tell us the exact reason when it fails").
 *
 *  What it does: before a task, the notification shade and system dialogs are closed and whatever app was open is put
 *  aside (Home, nothing of it is closed or lost). During a wallet-APP task, whenever another app, the home screen or the
 *  shade takes the screen, it is put aside again and the wallet app is brought back, up to [MAX_RECLAIMS] times, and the
 *  log names what took the screen. It never brings the app back once that could repeat a step that moves money (while a
 *  PIN is half typed, or after the hold / হ্যাঁ): there the run keeps its old careful rules. A USSD menu cannot be brought
 *  back once something closes it (the phone owns that dialog), so a USSD task only clears the screen first and names
 *  what took it. Touches on the screen are NOT blocked: a full-screen cover would also catch PayTrace's own taps. */
object TaskGuard {
    /** The wallet app gone from the screen this long = something took it. */
    const val LEFT_MS = 2_500L
    /** How many times one task brings its app back before it gives up and says who kept taking the screen. */
    const val MAX_RECLAIMS = 5

    enum class Step { WAIT, RECLAIM, GIVE_UP }

    /** Pure. [goneMs] since the task's app was last on screen; [reclaims] already done; [mayReopen] false while bringing the
     *  app back could repeat a money step (the caller's own timeout and rules then decide). */
    fun decide(goneMs: Long, reclaims: Int, mayReopen: Boolean): Step = when {
        goneMs < LEFT_MS || !mayReopen -> Step.WAIT
        reclaims >= MAX_RECLAIMS -> Step.GIVE_UP
        else -> Step.RECLAIM
    }

    /** Plain name of what is on screen, for the log. Pure. */
    fun nameOf(pkg: String?): String {
        val p = pkg?.lowercase() ?: return "nothing readable"
        return when {
            p == "com.android.systemui" -> "the notification shade"
            "launcher" in p || p.endsWith(".home") || p == "com.miui.home" || "nexuslauncher" in p -> "the home screen"
            "inputmethod" in p || p.endsWith(".ime") || "keyboard" in p -> "the keyboard"
            p == "com.android.phone" || "incallui" in p || "dialer" in p || "telecom" in p -> "the phone's dialer/call screen"
            else -> pkg
        }
    }

    /** What is in front, apart from the task's own app and PayTrace: the active window first. Pure on package names. */
    fun intruder(pkgs: List<String>, own: Set<String>): String? {
        val other = pkgs.firstOrNull { p -> p !in own && !p.contains("inputmethod") && p != "com.android.systemui" }
            ?: pkgs.firstOrNull { it == "com.android.systemui" }
        return other?.let { nameOf(it) }
    }

    /** Package names on screen, the active window first. */
    fun onScreen(svc: AccessibilityService): List<String> {
        val out = ArrayList<String>()
        try { svc.rootInActiveWindow?.packageName?.toString()?.let { out.add(it) } } catch (e: Exception) { }
        try { svc.windows.forEach { w -> w.root?.packageName?.toString()?.let { if (it !in out) out.add(it) } } } catch (e: Exception) { }
        return out
    }

    /** One phrase for the log: what took the screen from [own]. */
    fun whoTook(svc: AccessibilityService, own: Set<String>): String =
        intruder(onScreen(svc), own + svc.packageName) ?: "nothing readable (the screen may have gone off)"

    /** Closes the notification shade and system pop-ups so they cannot sit over the task. Never presses anything inside an
     *  app. Safe at any moment, including during a USSD menu. */
    fun clearScreen(svc: Context) {
        val a = svc as? AccessibilityService ?: return
        try {
            if (Build.VERSION.SDK_INT >= 31) a.performGlobalAction(AccessibilityService.GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
            else closeDialogs(a)
        } catch (e: Exception) { }
    }

    @Suppress("DEPRECATION")
    private fun closeDialogs(a: AccessibilityService) = a.sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))

    /** Brings the task's app back after something took the screen: wakes the phone through the wake window when the screen
     *  went off, else Home then the app. False when someone locked the phone with a PIN (no app can open it). */
    fun reopen(svc: AccessibilityService, app: Context, pkg: String, note: (String) -> Unit): Boolean {
        val st = ScreenWake.state(app)
        if (st == ScreenGate.State.LOCKED_SECURE) { note("the phone was locked during the task; no app can open it"); return false }
        AppReader.openBkash(svc, app, pkg, st == ScreenGate.State.WAKE_NEEDED, note)
        return true
    }

    /** The one step for an app run whose app is not on screen (after it had been). Returns the reason to stop with, or null
     *  to carry on. [reclaims] is read and bumped through [count]. */
    fun onGone(svc: AccessibilityService, app: Context, pkg: String, label: String, goneMs: Long, reclaims: Int, mayReopen: Boolean,
               count: () -> Unit, note: (String) -> Unit): String? = when (decide(goneMs, reclaims, mayReopen)) {
        Step.WAIT -> null
        Step.GIVE_UP -> "${whoTook(svc, setOf(pkg))} kept taking the screen from the $label app ($MAX_RECLAIMS times)"
        Step.RECLAIM -> {
            count()
            note("${whoTook(svc, setOf(pkg))} took the screen; putting it aside and bringing the $label app back (${reclaims + 1})")
            if (reopen(svc, app, pkg, note)) null else "the phone was locked during the task"
        }
    }
}

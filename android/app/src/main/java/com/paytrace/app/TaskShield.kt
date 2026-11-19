package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/** The touch freeze (owner 2026-11-19: "when PayTrace is doing a task, make it authoritative: every other app and screen
 *  touch frozen so that nothing can disturb"). While a dashboard task runs, the accessibility service puts an invisible
 *  "glass" over the whole screen (an accessibility overlay, above the app and the navigation bar) that takes every finger
 *  touch itself, with a small notice on it. It is lifted for a fraction of a second around each gesture PayTrace itself
 *  sends ([Gestures.send]), so the task's own taps and swipes still land, and put back the moment the gesture is over.
 *
 *  2026-11-19, after the owner's first try ("it shows the freeze but it is still touchable"): the glass was put back by a
 *  single timer that, when a second gesture came before the first one's time was up, fired early, found the lift still
 *  running, and never ran again, so the glass stayed lifted for the rest of the task. Now the put-back re-arms itself
 *  until the lift is really over ([LiftClock]), the lift is applied at once when called from the main thread (not posted
 *  behind the gesture it is meant to cover), a watchdog re-checks the glass twice a second, and every run's log ends
 *  with how long it was up and how many touches it took ([summary]).
 *
 *  What it cannot stop, said to the owner: the swipe-up Home and edge-swipe Back GESTURES on gesture-navigation phones
 *  (Android handles them before any window), the power button, and a call ringing (see [CallDecline]).
 *  Safety: it goes up only for a task, comes down the moment the task ends, and never later than [MAX_MS] (the server's
 *  own command limit), so a stuck task can never leave a phone frozen; if PayTrace's service dies, Android removes the
 *  window by itself. It is a per-phone dashboard switch ([AppSettings.taskShield], `allow.shield`). */
object TaskShield {
    const val MAX_MS = 180_000L
    /** How long after a gesture's own length the glass stays lifted (the phone may deliver the touch a little late). */
    const val LIFT_MARGIN_MS = 300L
    /** The watchdog: re-checks that the glass is really taking touches when no lift is running. */
    const val GUARD_MS = 500L

    /** When the glass is lifted until. Pure, unit tested: overlapping lifts keep the LATER end, never an earlier one. */
    class LiftClock {
        var until = 0L; private set
        /** A lift of [ms] starting [now]; returns when the glass goes back. */
        fun extend(now: Long, ms: Long): Long { val u = now + ms; if (u > until) until = u; return until }
        fun lifted(now: Long): Boolean = now < until
        fun dueIn(now: Long): Long = (until - now).coerceAtLeast(0L)
        fun reset() { until = 0L }
    }

    private val main = Handler(Looper.getMainLooper())
    private val clock = LiftClock()
    @Volatile private var view: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var wm: WindowManager? = null
    private var autoLower: Runnable? = null
    private var restore: Runnable? = null
    private var guard: Runnable? = null
    // For the run's log.
    @Volatile private var wanted = false
    @Volatile private var problem: String? = null
    @Volatile private var raisedAt = 0L
    @Volatile private var lifts = 0
    @Volatile private var blocked = 0
    @Volatile private var reattached = 0

    fun up(): Boolean = view != null

    private fun onMain(r: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) r() else main.post(r) }

    /** Puts the glass up for a task named [label] ("Cash In Tk 1,750"), if this phone's switch is on. Idempotent; the
     *  3-minute limit starts again. Safe from any thread. */
    fun raise(svc: Context?, label: String) {
        val a = svc as? AccessibilityService ?: return
        wanted = AppSettings(a.applicationContext).taskShield
        if (!wanted) return
        onMain {
            try {
                if (view == null) {
                    val w = a.getSystemService(Context.WINDOW_SERVICE) as WindowManager
                    val size = Point()
                    @Suppress("DEPRECATION")
                    if (Build.VERSION.SDK_INT >= 30) w.maximumWindowMetrics.bounds.let { size.set(it.width(), it.height()) } else w.defaultDisplay.getRealSize(size)
                    val p = WindowManager.LayoutParams(
                        size.x, size.y,
                        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                        PixelFormat.TRANSLUCENT,
                    )
                    p.gravity = Gravity.TOP or Gravity.START
                    p.x = 0; p.y = 0
                    // The glass covers the notch/cutout area too, so no strip at the top is left open.
                    if (Build.VERSION.SDK_INT >= 28) {
                        p.layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                        else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    }
                    // Under 0.8 so Android 12+'s "touch passed through an opaque overlay" rule can never swallow PayTrace's own taps.
                    p.alpha = 0.75f
                    val layout = FrameLayout(a)
                    layout.setBackgroundColor(Color.TRANSPARENT)
                    layout.isClickable = true
                    layout.isFocusable = false
                    layout.setOnTouchListener { _, ev -> if (ev.actionMasked == MotionEvent.ACTION_DOWN) blocked++; true }
                    val notice = TextView(a).apply {
                        text = "PayTrace is working: $label. Please do not touch the phone."
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.argb(210, 21, 101, 232))
                        textSize = 13f
                        val pad = (12 * a.resources.displayMetrics.density).toInt()
                        setPadding(pad, pad, pad, pad)
                    }
                    val lp = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT)
                    lp.topMargin = (72 * a.resources.displayMetrics.density).toInt()
                    layout.addView(notice, lp)
                    w.addView(layout, p)
                    view = layout; params = p; wm = w
                    problem = null; raisedAt = SystemClock.elapsedRealtime(); lifts = 0; blocked = 0; reattached = 0
                    clock.reset()
                    startGuard()
                } else {
                    ((view as? FrameLayout)?.getChildAt(0) as? TextView)?.text = "PayTrace is working: $label. Please do not touch the phone."
                }
                autoLower?.let { main.removeCallbacks(it) }
                val r = Runnable { lower() }
                autoLower = r
                main.postDelayed(r, MAX_MS)
            } catch (e: Exception) {
                // No glass on this phone: the task runs as before, and the log says why.
                problem = e.javaClass.simpleName
                view = null; params = null
            }
        }
    }

    /** One line for the run's log: whether the glass was up, for how long, how many touches it took, how often it was
     *  lifted for PayTrace's own taps. Read on the caller's thread so it lands in the log before the run reports. */
    fun summary(): String {
        val v = view
        return when {
            v != null -> "screen freeze: on for ${(SystemClock.elapsedRealtime() - raisedAt) / 1000} s, took $blocked touch(es), " +
                "lifted $lifts time(s) for PayTrace's own taps" + (if (reattached > 0) ", put back $reattached time(s) after Android removed it" else "")
            problem != null -> "screen freeze: could not be shown on this phone ($problem)"
            !wanted -> "screen freeze: off for this phone (dashboard switch)"
            else -> "screen freeze: was not up"
        }
    }

    /** Takes the glass down. Safe to call when it is not up. [note] gets the [summary] first, at once. */
    fun lower(note: ((String) -> Unit)? = null) {
        note?.invoke(summary())
        onMain {
            try { view?.let { wm?.removeView(it) } } catch (e: Exception) { }
            view = null; params = null; wm = null
            autoLower?.let { main.removeCallbacks(it) }; autoLower = null
            restore?.let { main.removeCallbacks(it) }; restore = null
            guard?.let { main.removeCallbacks(it) }; guard = null
            clock.reset()
        }
    }

    /** Lets touches through for [ms] (PayTrace's own gesture is about to be sent), then puts the glass back. Applied at
     *  once when called from the main thread, so the gesture dispatched right after it is covered. */
    fun lift(ms: Long) {
        onMain {
            if (view == null || params == null) return@onMain
            val now = SystemClock.elapsedRealtime()
            clock.extend(now, ms)
            lifts++
            setTouchable(false)
            scheduleRestore()
        }
    }

    /** The put-back: fires when the lift is due and, if a later lift moved the end, arms itself again for that end. */
    private fun scheduleRestore() {
        restore?.let { main.removeCallbacks(it) }
        val r = object : Runnable {
            override fun run() {
                if (view == null) return
                val now = SystemClock.elapsedRealtime()
                if (clock.lifted(now)) { main.postDelayed(this, clock.dueIn(now)); return }
                setTouchable(true)
                restore = null
            }
        }
        restore = r
        main.postDelayed(r, clock.dueIn(SystemClock.elapsedRealtime()))
    }

    private fun setTouchable(on: Boolean) {
        val v = view ?: return
        val p = params ?: return
        val isOn = p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0
        if (isOn == on) return
        p.flags = if (on) p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv() else p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        try { wm?.updateViewLayout(v, p) } catch (e: Exception) { }
    }

    /** Twice a second while the glass is up: no lift running = the glass must be taking touches; and if Android took the
     *  window away (a few brands do that on a screen change), it is put back. */
    private fun startGuard() {
        guard?.let { main.removeCallbacks(it) }
        val g = object : Runnable {
            override fun run() {
                val v = view ?: return
                val p = params
                val w = wm
                try {
                    if (!clock.lifted(SystemClock.elapsedRealtime())) setTouchable(true)
                    if (p != null && w != null && !v.isAttachedToWindow) { w.addView(v, p); reattached++ }
                } catch (e: Exception) { }
                main.postDelayed(this, GUARD_MS)
            }
        }
        guard = g
        main.postDelayed(g, GUARD_MS)
    }

    /** Hardware keys while the glass is up: Back and the app switcher are swallowed (Home cannot be: Android keeps it). */
    fun swallows(keyCode: Int): Boolean = up() && (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_APP_SWITCH || keyCode == KeyEvent.KEYCODE_MENU)
}

/** Every gesture PayTrace sends goes through here, so the touch freeze is lifted for exactly as long as the gesture takes.
 *  The lift goes FIRST and the gesture follows [LEAD_MS] later: Android applies a window change on its next frame, and a
 *  tap sent in the same instant as the lift met the glass still solid (the Vivo, 2026-11-19 23:07: "digit 1 did not show
 *  in the box" three reads in a row with the freeze on, where the same taps had typed the PIN at 22:33 with it off). */
object Gestures {
    /** Head start the lift gets before the gesture is sent. */
    const val LEAD_MS = 120L

    /** The longest a gesture's strokes run, in ms. Pure. */
    fun lengthOf(starts: List<Long>, durations: List<Long>): Long =
        starts.indices.maxOfOrNull { starts[it] + durations[it] } ?: 0L

    /** How long the glass is lifted for a gesture of [length] ms: the head start, the gesture, and a margin after it. Pure. */
    fun liftFor(length: Long): Long = LEAD_MS + length + TaskShield.LIFT_MARGIN_MS

    fun send(svc: AccessibilityService, g: GestureDescription, cb: AccessibilityService.GestureResultCallback? = null): Boolean {
        if (!TaskShield.up()) return svc.dispatchGesture(g, cb, null)
        val starts = ArrayList<Long>(); val durs = ArrayList<Long>()
        for (i in 0 until g.strokeCount) { val s = g.getStroke(i); starts.add(s.startTime); durs.add(s.duration) }
        TaskShield.lift(liftFor(lengthOf(starts, durs)))
        // The answer cannot be known yet; a refused dispatch is rare (the service lacks the gesture capability) and shows up
        // in the run as a tap that changed nothing, which every run already handles.
        Handler(Looper.getMainLooper()).postDelayed({ try { svc.dispatchGesture(g, cb, null) } catch (e: Exception) { } }, LEAD_MS)
        return true
    }
}

/** An incoming call during a task is declined (owner 2026-11-19: "decline calls too"; these phones are used for nothing
 *  else). Only a RINGING call is ended, never one already under way, and never a USSD menu (that is not a call to Android). */
object CallDecline {
    private var lastAt = 0L

    /** True when a ringing call was just declined. Needs READ_PHONE_STATE (to see it ring) and ANSWER_PHONE_CALLS (to end it). */
    fun declineRinging(ctx: Context): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (now - lastAt < 3_000) return false
        return try {
            val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            @Suppress("DEPRECATION")
            if (tm.callState != TelephonyManager.CALL_STATE_RINGING) return false
            lastAt = now
            val tc = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            @Suppress("DEPRECATION")
            if (Build.VERSION.SDK_INT >= 28) tc.endCall() else false
        } catch (e: Exception) { false }
    }
}

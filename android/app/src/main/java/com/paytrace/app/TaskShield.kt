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
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView

/** The touch freeze (owner 2026-11-19: "when PayTrace is doing a task, make it authoritative: every other app and screen
 *  touch frozen so that nothing can disturb"). While a dashboard task runs, the accessibility service puts an invisible
 *  "glass" over the whole screen (an accessibility overlay, above the app and the navigation bar) that swallows every
 *  finger touch, with a small notice on it. It is lifted for a fraction of a second around each gesture PayTrace itself
 *  sends ([Gestures.send]), so the task's own taps and swipes still land, and put back at once.
 *
 *  What it cannot stop, said to the owner: the swipe-up Home and edge-swipe Back GESTURES on gesture-navigation phones
 *  (Android handles them before any window), the power button, and a call ringing (see [TaskGuard.declineRinging]).
 *  Safety: it goes up only for a task, comes down the moment the task ends, and never later than [MAX_MS] (the server's
 *  own command limit), so a stuck task can never leave a phone frozen; if PayTrace's service dies, Android removes the
 *  window by itself. It is a per-phone dashboard switch ([AppSettings.taskShield], `allow.shield`), off until the owner
 *  has seen a task work through it on one phone. */
object TaskShield {
    const val MAX_MS = 180_000L
    /** How long after a gesture's own length the glass stays lifted (the phone may deliver the touch a little late). */
    const val LIFT_MARGIN_MS = 300L

    private val main = Handler(Looper.getMainLooper())
    @Volatile private var view: View? = null
    private var params: WindowManager.LayoutParams? = null
    private var wm: WindowManager? = null
    private var liftedUntil = 0L
    private var autoLower: Runnable? = null
    private var restore: Runnable? = null

    fun up(): Boolean = view != null

    /** Puts the glass up for a task named [label] ("Cash In Tk 1,750"), if this phone's switch is on. Idempotent; the
     *  3-minute limit starts again. Safe from any thread. */
    fun raise(svc: Context?, label: String) {
        val a = svc as? AccessibilityService ?: return
        if (!AppSettings(a.applicationContext).taskShield) return
        main.post {
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
                    // Under 0.8 so Android 12+'s "touch passed through an opaque overlay" rule can never swallow PayTrace's own taps.
                    p.alpha = 0.75f
                    val layout = FrameLayout(a)
                    layout.setBackgroundColor(Color.TRANSPARENT)
                    layout.setOnTouchListener { _, _ -> true }
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
                } else {
                    ((view as? FrameLayout)?.getChildAt(0) as? TextView)?.text = "PayTrace is working: $label. Please do not touch the phone."
                }
                autoLower?.let { main.removeCallbacks(it) }
                val r = Runnable { lower() }
                autoLower = r
                main.postDelayed(r, MAX_MS)
            } catch (e: Exception) {
                // No glass on this phone: the task runs as before.
                view = null; params = null
            }
        }
    }

    /** Takes the glass down. Safe to call when it is not up. */
    fun lower() {
        main.post {
            try { view?.let { wm?.removeView(it) } } catch (e: Exception) { }
            view = null; params = null; wm = null
            autoLower?.let { main.removeCallbacks(it) }; autoLower = null
            restore?.let { main.removeCallbacks(it) }; restore = null
            liftedUntil = 0L
        }
    }

    /** Lets touches through for [ms] (PayTrace's own gesture is about to be sent), then puts the glass back. */
    fun lift(ms: Long) {
        main.post {
            val v = view ?: return@post
            val p = params ?: return@post
            val until = SystemClock.elapsedRealtime() + ms
            if (until > liftedUntil) liftedUntil = until
            try {
                if (p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE == 0) {
                    p.flags = p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                    wm?.updateViewLayout(v, p)
                }
            } catch (e: Exception) { }
            restore?.let { main.removeCallbacks(it) }
            val r = Runnable {
                try {
                    if (SystemClock.elapsedRealtime() >= liftedUntil && view != null) {
                        p.flags = p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
                        wm?.updateViewLayout(view, p)
                    }
                } catch (e: Exception) { }
            }
            restore = r
            main.postDelayed(r, ms)
        }
    }

    /** Hardware keys while the glass is up: Back and the app switcher are swallowed (Home cannot be: Android keeps it). */
    fun swallows(keyCode: Int): Boolean = up() && (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_APP_SWITCH || keyCode == KeyEvent.KEYCODE_MENU)
}

/** Every gesture PayTrace sends goes through here, so the touch freeze is lifted for exactly as long as the gesture takes. */
object Gestures {
    /** The longest a gesture's strokes run, in ms. Pure. */
    fun lengthOf(starts: List<Long>, durations: List<Long>): Long =
        starts.indices.maxOfOrNull { starts[it] + durations[it] } ?: 0L

    fun send(svc: AccessibilityService, g: GestureDescription, cb: AccessibilityService.GestureResultCallback? = null): Boolean {
        if (TaskShield.up()) {
            val starts = ArrayList<Long>(); val durs = ArrayList<Long>()
            for (i in 0 until g.strokeCount) { val s = g.getStroke(i); starts.add(s.startTime); durs.add(s.duration) }
            TaskShield.lift(lengthOf(starts, durs) + TaskShield.LIFT_MARGIN_MS)
        }
        return svc.dispatchGesture(g, cb, null)
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

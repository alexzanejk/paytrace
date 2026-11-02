package com.paytrace.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.WindowManager

/** Whether this phone can be driven right now, and what has to happen first. Pure, so the rule is unit tested.
 *
 *  The wall: when a phone has a REAL screen lock (PIN, pattern, password, fingerprint), Android does not let any app
 *  unlock it. That is the whole point of a lock screen and no amount of code gets past it. The menus PayTrace walks
 *  are drawn by the phone's own dialer, which is behind that lock, so a dashboard command simply cannot run.
 *
 *  What CAN be done: a phone with NO lock, or only "Swipe", is not protecting anything, so PayTrace may wake the
 *  screen and push the lock screen aside itself. These are dedicated payment phones, so that is the setting to use. */
object ScreenGate {
    enum class State {
        /** The screen is on and nothing is in the way. */
        READY,
        /** Asleep, or a lock screen that can be pushed aside because the phone is not really locked. */
        WAKE_NEEDED,
        /** A real lock. Nothing can be done until a person unlocks the phone. */
        LOCKED_SECURE,
    }

    fun decide(interactive: Boolean, keyguardLocked: Boolean, deviceSecure: Boolean): State = when {
        keyguardLocked && deviceSecure -> State.LOCKED_SECURE
        keyguardLocked || !interactive -> State.WAKE_NEEDED
        else -> State.READY
    }
}

/** Reads the phone's own state and wakes it when a run needs the screen. */
object ScreenWake {
    fun state(ctx: Context): ScreenGate.State {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val km = ctx.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val interactive = try { pm?.isInteractive != false } catch (e: Exception) { true }
        val locked = try { km?.isKeyguardLocked == true } catch (e: Exception) { false }
        // isDeviceSecure is the honest one: it is false for "None" and "Swipe", true for PIN/pattern/password.
        val secure = try { km?.isDeviceSecure == true } catch (e: Exception) { false }
        return ScreenGate.decide(interactive, locked, secure)
    }

    /** True when this phone has a real lock, so a person has to unlock it. */
    fun locked(ctx: Context): Boolean = state(ctx) == ScreenGate.State.LOCKED_SECURE

    /** Turns the screen on and pushes an unsecured lock screen aside. Does nothing a person has to allow. */
    fun wakeUp(ctx: Context) {
        try {
            val i = Intent(ctx.applicationContext, WakeActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            ctx.startActivity(i)
        } catch (e: Exception) {
            // The run goes on: on some phones the screen is already on, and the next check says what is really true.
        }
    }

    /** How long to give Android to light the screen and take the lock screen away. */
    const val WAKE_MS = 1_800L
}

/** An empty window whose only job is to wake the phone for a run.
 *
 *  It is allowed to show over the lock screen and to turn the screen on (that is what those two flags are for), and it
 *  asks Android to take the lock screen away. On a phone with no lock that happens by itself; on a locked phone Android
 *  shows the person the unlock screen instead and PayTrace simply stops, which is as it should be. It closes at once so
 *  the dialer has the screen to itself. */
class WakeActivity : Activity() {
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            } else {
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
                )
            }
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && km != null) {
                // On a phone with no real lock this takes the lock screen away by itself. On a locked phone it asks
                // the person, and PayTrace does not wait for that.
                km.requestDismissKeyguard(this, null)
            }
        } catch (e: Exception) {
            // Nothing here is worth crashing a payment phone for.
        }
    }

    override fun onResume() {
        super.onResume()
        // Out of the way immediately: the dialer needs the screen, not this.
        window.decorView.postDelayed({ try { finish() } catch (e: Exception) { } }, CLOSE_MS)
    }

    companion object { const val CLOSE_MS = 400L }
}

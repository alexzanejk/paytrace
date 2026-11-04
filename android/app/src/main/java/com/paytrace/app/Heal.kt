package com.paytrace.app

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The list Android keeps of the accessibility services that are switched on: component names separated by colons.
 *  Pure, so it is unit tested: other apps' services must never be lost, and ours must never be listed twice. */
object AccessibilityList {
    fun has(current: String?, component: String): Boolean =
        parts(current).any { it.equals(component, ignoreCase = true) }

    fun withService(current: String?, component: String): String {
        val list = parts(current)
        if (list.any { it.equals(component, ignoreCase = true) }) return list.joinToString(":")
        return (list + component).joinToString(":")
    }

    /** The list with our service taken out and every other service kept exactly where it was. */
    fun withoutService(current: String?, component: String): String =
        parts(current).filter { !it.equals(component, ignoreCase = true) }.joinToString(":")

    private fun parts(current: String?): List<String> =
        (current ?: "").split(':').map { it.trim() }.filter { it.isNotEmpty() }
}

/** Android switches PayTrace OFF in Accessibility settings every time the app is updated, because the app was installed from a
 *  file rather than a store ("restricted setting"). On a phone where the balance check is done through the dialer that means the
 *  check stops working after each update until someone notices.
 *
 *  If the owner has given this phone WRITE_SECURE_SETTINGS once, over a cable or wireless debugging
 *  ("adb shell pm grant com.paytrace.app android.permission.WRITE_SECURE_SETTINGS"), PayTrace puts itself back into that list by
 *  itself. Without the permission nothing happens at all, and the owner switches it on by hand as before. This is the only use
 *  of that permission: PayTrace's own balance-check service, and no other setting is ever written. */
object AccessibilityHeal {
    /** After switching PayTrace back on in Accessibility settings, the time Android needs to start the service. */
    const val HEAL_PAUSE_MS = 2_500L

    fun allowed(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED

    /** Before a run that needs the service: put it back if an update took it out of the list, or switch it off and on if it
     *  is listed but dead ([AccessibilityRepair]), give Android the moment it needs, then run. Otherwise run at once. The
     *  note handed to [then] is a line for the run's own log, empty when nothing was done. */
    fun prepare(ctx: Context, then: (String) -> Unit) {
        val app = ctx.applicationContext
        val (wait, note) = when {
            heal(app) -> HEAL_PAUSE_MS to "accessibility: switched PayTrace back on after an app update"
            AccessibilityRepair.beforeRun(app) -> AccessibilityRepair.PAUSE_MS to "accessibility: the service was not running, switched it off and on again"
            else -> 0L to ""
        }
        if (wait > 0L) Handler(Looper.getMainLooper()).postDelayed({ then(note) }, wait) else then(note)
    }

    /** True only when this call actually switched the service back on (so the caller can give Android a moment to start it). */
    fun heal(ctx: Context): Boolean {
        val app = ctx.applicationContext
        if (UssdSetup.accessibilityOn(app)) return false
        if (!allowed(app)) return false
        return try {
            val me = ComponentName(app, UssdAccessibilityService::class.java).flattenToString()
            val cr = app.contentResolver
            val now = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            if (AccessibilityList.has(now, me)) return false
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, AccessibilityList.withService(now, me))
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
            true
        } catch (e: Exception) {
            // No permission after all, or the phone refuses: the owner switches it on by hand.
            false
        }
    }
}

/** Pure: when a service that is switched on but not running should be switched off and on again. Times are the phone's
 *  uptime clock in milliseconds. Unit tested. */
object RepairPolicy {
    /** "Switched on but not running" must last this long before it counts as dead rather than still starting. */
    const val DEAD_MS = 10_000L
    /** From the heartbeat, not more often than this, so a phone that kills the service every time cannot flap for ever. */
    const val RETRY_MS = 5 * 60_000L

    fun due(
        listed: Boolean, connected: Boolean, allowed: Boolean, busy: Boolean,
        deadSince: Long, lastTry: Long, now: Long, minDead: Long = DEAD_MS, retry: Long = RETRY_MS,
    ): Boolean {
        if (!listed || connected || !allowed || busy) return false
        if (deadSince <= 0L || now - deadSince < minDead) return false
        if (lastTry > 0L && now - lastTry < retry) return false
        return true
    }
}

/** The second thing that goes wrong with the accessibility service, found on the owner's Redmi Note 10 Pro (2026-11-04):
 *  Android's switch reads ON, but Settings says "This service is malfunctioning" / "Not working". That is Android's own
 *  behaviour since version 9: when the app's process is killed while the service is connected (MIUI stopping PayTrace
 *  in the background, a flat battery), the service is marked crashed and is NOT started again until someone switches
 *  it OFF and ON. On a payment phone nobody is there to do that, so every dashboard command fails until noticed.
 *
 *  Where this phone has WRITE_SECURE_SETTINGS (the same one-time adb grant [AccessibilityHeal] uses), PayTrace does the
 *  OFF and ON itself: it takes its own service out of the list, waits a moment, and puts it back; Android then binds it
 *  again. Never during a running command, never more than once in five minutes from the heartbeat, only our own entry
 *  in the list, and what it did goes into the card's log and the next run's "What the phone saw". Without the grant
 *  nothing happens and the card shows the red warning as before. Whether MIUI restarts the service on a list written
 *  by the app, as plain Android does, is to be proved on that phone. */
object AccessibilityRepair {
    /** Time between taking the service out of the list and putting it back, so Android sees two changes, not one. */
    const val OFF_MS = 1_500L
    /** After putting it back, the time to wait before judging whether the service came back. */
    const val SETTLE_MS = 4_000L
    /** How long a caller should wait after a repair started before it needs the service. */
    const val PAUSE_MS = OFF_MS + 3_000L
    private const val RUN_RETRY_MS = 60_000L
    private const val LOG_LINES = 6

    @Volatile private var deadSince = 0L
    @Volatile private var lastTry = 0L
    @Volatile private var busyUntil = 0L
    private val main by lazy { Handler(Looper.getMainLooper()) }

    /** Called on every heartbeat (about every 30 s). True when a repair was started this time. */
    fun check(ctx: Context): Boolean = maybe(ctx, RepairPolicy.DEAD_MS, RepairPolicy.RETRY_MS, "heartbeat")

    /** Just before a dashboard command needs the service: no waiting, the command needs it now. */
    fun beforeRun(ctx: Context): Boolean = maybe(ctx, 0L, RUN_RETRY_MS, "before a command")

    /** The button on the Settings card. */
    fun now(ctx: Context): Boolean = maybe(ctx, 0L, 0L, "by hand")

    /** The service is listed but not running (the state Settings calls "malfunctioning"). */
    fun looksDead(ctx: Context): Boolean = UssdSetup.accessibilityOn(ctx) && !UssdSession.connected()

    @Synchronized private fun maybe(ctx: Context, minDead: Long, retry: Long, why: String): Boolean {
        val app = ctx.applicationContext
        val now = SystemClock.elapsedRealtime()
        val listed = UssdSetup.accessibilityOn(app)
        val connected = UssdSession.connected()
        if (!listed || connected) { deadSince = 0L; return false }
        if (deadSince == 0L) deadSince = now
        if (now < busyUntil) return false
        if (!RepairPolicy.due(listed, connected, AccessibilityHeal.allowed(app), UssdSession.active(), deadSince, lastTry, now, minDead, retry)) return false
        lastTry = now
        busyUntil = now + OFF_MS + SETTLE_MS + 1_000L
        start(app, why)
        return true
    }

    private fun start(app: Context, why: String) {
        val me = ComponentName(app, UssdAccessibilityService::class.java).flattenToString()
        val cr = app.contentResolver
        val s = AppSettings(app)
        val key = Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        try {
            Settings.Secure.putString(cr, key, AccessibilityList.withoutService(Settings.Secure.getString(cr, key), me))
        } catch (e: Exception) {
            log(s, "repair ($why) failed: the phone refused to change the setting")
            return
        }
        main.postDelayed({
            try {
                Settings.Secure.putString(cr, key, AccessibilityList.withService(Settings.Secure.getString(cr, key), me))
                Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
            } catch (e: Exception) {
                // Taken out but not put back: the next heartbeat's AccessibilityHeal adds it again.
                log(s, "repair ($why) failed half way: the phone refused to switch it back on")
                return@postDelayed
            }
            main.postDelayed({
                val ok = UssdSession.connected()
                if (ok) { s.a11yRepairs = s.a11yRepairs + 1; deadSince = 0L }
                log(s, if (ok) "repaired ($why): switched off and on, the service came back" else "tried ($why): switched off and on, the service did not come back")
            }, SETTLE_MS)
        }, OFF_MS)
    }

    private fun log(s: AppSettings, line: String) {
        val stamp = SimpleDateFormat("dd/MM HH:mm", Locale.US).format(Date())
        val lines = (listOf("$stamp $line") + s.a11yRepairLog.lines().filter { it.isNotBlank() }).take(LOG_LINES)
        s.a11yRepairLog = lines.joinToString("\n")
    }
}

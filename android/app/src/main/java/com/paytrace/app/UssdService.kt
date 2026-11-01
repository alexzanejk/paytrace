package com.paytrace.app

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** How a run ended. [error] is a short code (see [UssdText.error]); [balance] is set when [ok]. */
data class UssdOutcome(val ok: Boolean, val balance: Double?, val error: String?)

/** Plain wording for the codes above, for the screen on the phone. */
object UssdText {
    fun error(code: String?): String = when (code) {
        null, "" -> ""
        "not_allowed" -> "The switch on this phone is off, so nothing was done."
        "no_accessibility" -> "PayTrace is not switched on in Accessibility settings."
        "no_call_permission" -> "The phone-call permission is missing."
        "no_pin" -> "No Nagad PIN is saved on this phone."
        "busy" -> "Another check is still running."
        "timeout" -> "The phone did not answer in time. Try again."
        "unexpected_screen" -> "The Nagad menu looked different from what PayTrace expects, so it stopped. Nothing was sent."
        "too_many_steps" -> "The menu took too many steps, so it stopped."
        "no_input_box", "no_send_button" -> "PayTrace could not use the phone's menu box."
        "sim_not_found" -> "Could not pick the SIM. Check the SIM number in settings."
        "dial_failed" -> "The phone could not start the code."
        "unsupported" -> "This phone's app does not know that command yet. Update the app."
        else -> "It did not work."
    }
}

/** What the phone's accessibility tree shows for one dialog: the message words, the input box and the buttons.
 *  The box's own text (where the PIN is typed) is never read. */
class UssdWindow(val text: String, val edit: AccessibilityNodeInfo?, val buttons: List<AccessibilityNodeInfo>, val roots: AccessibilityNodeInfo)

private class Collector {
    val texts = ArrayList<String>()
    var edit: AccessibilityNodeInfo? = null
    val buttons = ArrayList<AccessibilityNodeInfo>()
}

private fun walk(n: AccessibilityNodeInfo?, c: Collector, depth: Int) {
    if (n == null || depth > 25) return
    val cls = n.className?.toString() ?: ""
    if (cls.endsWith("EditText") || n.isEditable) {
        if (c.edit == null) c.edit = n
    } else if (cls.endsWith("Button")) {
        c.buttons.add(n)
    } else if (cls.endsWith("TextView")) {
        val t = n.text?.toString()
        if (!t.isNullOrBlank()) c.texts.add(t)
    }
    for (i in 0 until n.childCount) walk(n.getChild(i), c, depth + 1)
}

private fun clickUp(node: AccessibilityNodeInfo?): Boolean {
    var n = node
    var guard = 0
    while (n != null && guard < 6) {
        if (n.isClickable) return n.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        n = n.parent
        guard++
    }
    return false
}

/** The dialer's green Call button: a clickable view labelled "Dial" or "Call" (an icon, so it is found by its description). */
private fun findCallButton(n: AccessibilityNodeInfo?, depth: Int = 0): AccessibilityNodeInfo? {
    if (n == null || depth > 25) return null
    if (UssdLabels.isCallButton(n.contentDescription?.toString()) && (n.isClickable || n.parent?.isClickable == true)) return n
    for (i in 0 until n.childCount) findCallButton(n.getChild(i), depth + 1)?.let { return it }
    return null
}

private fun clickButton(w: UssdWindow, vararg labels: String): Boolean {
    val b = w.buttons.firstOrNull { btn -> labels.any { it.equals(btn.text?.toString()?.trim(), ignoreCase = true) } } ?: return false
    return b.performAction(AccessibilityNodeInfo.ACTION_CLICK)
}

/** One run at a time. Only while a run is active does the service look at any window, and then only the phone's own
 *  call/USSD dialogs; it never reads or touches anything else. All of it happens on the main thread. */
object UssdSession {
    private val main = Handler(Looper.getMainLooper())
    private var flow: NagadBalanceFlow? = null
    private var onFinish: ((UssdOutcome) -> Unit)? = null
    private var slot = 0
    private var timeout: Runnable? = null
    private var service: AccessibilityService? = null
    // 0 = the dialer is open with *167# typed and its Call button has not been pressed yet; 1 = Call was pressed.
    private var phase = 0
    // Becomes true when the first Nagad menu (or the SIM question) shows up; screens before that are just the dialer keypad.
    private var seenUssd = false

    @Synchronized fun active(): Boolean = flow != null

    @Synchronized fun start(slot: Int, flow: NagadBalanceFlow, timeoutMs: Long, onFinish: (UssdOutcome) -> Unit) {
        this.slot = slot
        this.flow = flow
        this.onFinish = onFinish
        this.phase = 0
        this.seenUssd = false
        val t = Runnable { finish(UssdOutcome(false, null, "timeout")) }
        timeout = t
        main.postDelayed(t, timeoutMs)
    }

    fun attach(s: AccessibilityService?) { service = s }

    /** True while the dialer is waiting for its Call button to be pressed. */
    @Synchronized fun stillDialing(): Boolean = flow != null && phase == 0

    /** The accessibility service's own context, which Android lets open screens more freely than a background service. */
    fun launchContext(): Context? = service

    /** Only the phone's own call and menu windows may be read. */
    fun allowedPackage(pkg: String): Boolean =
        pkg == "com.android.phone" || pkg == "com.android.server.telecom" || pkg == "com.android.contacts" ||
            pkg.contains("incallui") || pkg.contains("dialer") || pkg.contains("telecom")

    fun onWindow(w: UssdWindow) {
        val f = synchronized(this) { flow } ?: return
        val lower = w.text.lowercase()
        val chooser = lower.contains("choose sim") || lower.contains("select sim")
        val ussdScreen = NagadUssd.classify(w.text) != UssdScreen.OTHER
        // The dialer is open with *167# typed in: press its green Call button, exactly as a person does.
        if (phase == 0) {
            if (!chooser && !ussdScreen) {
                val btn = findCallButton(w.roots)
                if (btn != null && clickUp(btn)) phase = 1
                return
            }
            phase = 1
        }
        // "Choose SIM for this call": tap the SIM the owner picked in settings.
        if (chooser) {
            val label = "SIM" + (slot + 1)
            val row = findRow(w.roots, label)
            if (row == null || !clickUp(row)) finish(UssdOutcome(false, null, "sim_not_found"))
            return
        }
        // The phone's own refusal of the code.
        if (lower.contains("connection problem") || lower.contains("invalid mmi")) { finish(UssdOutcome(false, null, "dial_failed")); return }
        // Until the first Nagad screen appears, what is on the screen is only the dialer's keypad: wait for the menu.
        if (ussdScreen) seenUssd = true else if (!seenUssd) return
        when (val a = f.onScreen(w.text)) {
            is UssdAction.Wait -> Unit
            is UssdAction.Reply -> reply(w, a.text)
            is UssdAction.Done -> finish(UssdOutcome(true, a.balance, null))
            is UssdAction.Fail -> finish(UssdOutcome(false, null, a.reason))
        }
    }

    private fun findRow(n: AccessibilityNodeInfo?, label: String, depth: Int = 0): AccessibilityNodeInfo? {
        if (n == null || depth > 25) return null
        val t = n.text?.toString()
        if (t != null && t.replace(" ", "").startsWith(label, ignoreCase = true)) return n
        for (i in 0 until n.childCount) findRow(n.getChild(i), label, depth + 1)?.let { return it }
        return null
    }

    private fun reply(w: UssdWindow, text: String) {
        val edit = w.edit
        if (edit == null) { finish(UssdOutcome(false, null, "no_input_box")); return }
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (!edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) { finish(UssdOutcome(false, null, "no_input_box")); return }
        // A short pause so the dialog accepts the typed text before Send is pressed.
        main.postDelayed({
            if (!active()) return@postDelayed
            if (!clickButton(w, "send", "ok", "reply")) finish(UssdOutcome(false, null, "no_send_button"))
        }, 300)
    }

    fun abort(error: String) = finish(UssdOutcome(false, null, error))

    private fun finish(outcome: UssdOutcome) {
        val cb: ((UssdOutcome) -> Unit)?
        synchronized(this) {
            if (flow == null) return
            flow = null
            cb = onFinish
            onFinish = null
            timeout?.let { main.removeCallbacks(it) }
            timeout = null
        }
        // Close the menu the phone left open, then go back to the home screen.
        main.post {
            try {
                val root = service?.rootInActiveWindow
                if (root != null && allowedPackage(root.packageName?.toString() ?: "")) {
                    val c = Collector()
                    walk(root, c, 0)
                    clickButton(UssdWindow("", null, c.buttons, root), "cancel", "dismiss", "ok", "close")
                }
            } catch (e: Exception) {
                // Best effort: the run is over either way.
            }
            main.postDelayed({ try { service?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { } }, 500)
        }
        cb?.invoke(outcome)
    }
}

/** The service the owner switches on once per phone in Accessibility settings. It does nothing unless a run is active. */
class UssdAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        UssdSession.attach(this)
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        UssdSession.attach(null)
        return super.onUnbind(intent)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val ev = event ?: return
        if (!UssdSession.active()) return
        if (ev.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && ev.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) return
        val root = rootInActiveWindow ?: return
        val pkg = root.packageName?.toString() ?: return
        if (!UssdSession.allowedPackage(pkg)) return
        val c = Collector()
        walk(root, c, 0)
        if (c.texts.isEmpty()) return
        UssdSession.onWindow(UssdWindow(c.texts.joinToString("\n"), c.edit, c.buttons, root))
    }

    override fun onInterrupt() {}
}

object UssdSetup {
    fun accessibilityOn(ctx: Context): Boolean {
        val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(ctx, UssdAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    fun callPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED

    fun pinSaved(ctx: Context): Boolean = SecretStore(ctx.applicationContext, "ussd_pin").get().isNotEmpty()
}

/** Dials *167# and lets [UssdSession] walk the menus. Everything is checked first; the PIN is read from the encrypted
 *  store only now, and only kept in memory for this run. */
object UssdRunner {
    private const val RUN_MS = 90_000L
    private const val DIAL_FALLBACK_MS = 8_000L

    @Suppress("DEPRECATION")
    fun run(ctx: Context, onFinish: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val s = AppSettings(app)
        fun fail(e: String) = onFinish(UssdOutcome(false, null, e))
        if (!s.ussdAllowed) return fail("not_allowed")
        if (!UssdSetup.accessibilityOn(app)) return fail("no_accessibility")
        if (!UssdSetup.callPermission(app)) return fail("no_call_permission")
        val pin = SecretStore(app, "ussd_pin").get()
        if (pin.isEmpty()) return fail("no_pin")
        if (UssdSession.active()) return fail("busy")
        UssdSession.start(s.ussdSlot, NagadBalanceFlow { pin }, RUN_MS, onFinish)
        try {
            // The phone's screen may be off: wake it so the menu can be shown.
            val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "paytrace:ussd").acquire(RUN_MS + 5_000)
        } catch (e: Exception) {
            // The call may still work with the screen on.
        }
        // Open the phone's dialer with *167# typed in, the way a person starts it. The service then presses Call and picks the SIM.
        val opener = UssdSession.launchContext() ?: app
        try {
            opener.startActivity(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", NagadUssd.CODE, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            UssdSession.abort("dial_failed")
            return
        }
        // If the Call button was not found or pressed in a few seconds, place the call directly instead (same result, no keypad).
        Handler(Looper.getMainLooper()).postDelayed({
            if (UssdSession.stillDialing()) {
                try {
                    (UssdSession.launchContext() ?: app).startActivity(
                        Intent(Intent.ACTION_CALL, Uri.fromParts("tel", NagadUssd.CODE, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                } catch (e: SecurityException) {
                    UssdSession.abort("no_call_permission")
                } catch (e: Exception) {
                    UssdSession.abort("dial_failed")
                }
            }
        }, DIAL_FALLBACK_MS)
    }
}

/** A command from the dashboard, delivered on the heartbeat reply. Runs it and reports the answer back. */
object UssdCommands {
    fun onReply(ctx: Context, body: String?) {
        if (body == null) return
        val cmd = try { JSONObject(body).optJSONObject("command") } catch (e: Exception) { null } ?: return
        val id = cmd.optString("id")
        if (id.isBlank()) return
        if (cmd.optString("kind") != "balance" || cmd.optString("provider") != "nagad") {
            report(ctx, id, UssdOutcome(false, null, "unsupported"))
            return
        }
        UssdRunner.run(ctx) { outcome ->
            remember(ctx, outcome)
            report(ctx, id, outcome)
        }
    }

    /** Kept on the phone so the Settings card can show the last result. */
    fun remember(ctx: Context, o: UssdOutcome) {
        val j = JSONObject().put("at", System.currentTimeMillis()).put("ok", o.ok)
        if (o.balance != null) j.put("balance", o.balance)
        if (o.error != null) j.put("error", o.error)
        AppSettings(ctx).ussdLast = j.toString()
    }

    private fun report(ctx: Context, id: String, o: UssdOutcome) {
        Thread {
            try {
                val j = JSONObject().put("action", "command_result").put("id", id).put("ok", o.ok)
                if (o.balance != null) j.put("balance", o.balance)
                if (o.error != null) j.put("error", o.error)
                Sender.send(AppSettings(ctx.applicationContext), j)
            } catch (e: Exception) {
                // The server marks the command failed after a few minutes if no answer arrives.
            }
        }.start()
    }
}

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
import android.os.SystemClock
import android.telecom.TelecomManager
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Locale

/** How a run ended. [error] is a short code (see [UssdText.error]); [balance] is set when [ok]. [pinSent] is true only if the PIN was
 *  really submitted (then nothing is ever retried by itself). [trace] is a short log of the steps, never containing the PIN. */
data class UssdOutcome(val ok: Boolean, val balance: Double?, val error: String?, val pinSent: Boolean = false, val trace: String = "")

/** Plain wording for the codes above, for the screen on the phone. */
object UssdText {
    fun error(code: String?): String = when (code) {
        null, "" -> ""
        "not_allowed" -> "The switch on this phone is off, so nothing was done."
        "no_accessibility" -> "PayTrace is not switched on in Accessibility settings."
        "no_call_permission" -> "The phone-call permission is missing."
        "no_pin" -> "No Nagad PIN is saved on this phone."
        "busy" -> "Another check is still running."
        "network_refused" -> "The provider answered that the service is not available right now. Try again a little later."
        "too_soon" -> "A check just finished. Wait about a minute and try again."
        "ussd_failed" -> "The wallet answered, but Android does not pass that kind of answer on to an app. PayTrace has moved this phone to the Dialer way, which reads the phone's own menu. Try the check again."
        "timeout" -> "The phone did not answer in time. Try again."
        "no_answer_after_pin" -> "The PIN was entered but no balance came back. PayTrace did not try the PIN again. Check the Nagad SMS, then try again later."
        "unexpected_screen" -> "The Nagad menu looked different from what PayTrace expects, so it stopped. Nothing was sent."
        "too_many_steps" -> "The menu took too many steps, so it stopped."
        "no_input_box", "no_send_button" -> "PayTrace could not use the phone's menu box."
        "sim_not_found" -> "Could not pick the SIM. Check the SIM number in settings."
        "sim_no_service" -> "The SIM chosen here is grey on the phone's own screen, so it has no network and cannot be used. Choose the other SIM above, or put a working SIM in that slot."
        "dial_failed" -> "The phone could not start the code."
        "unsupported" -> "This phone's app does not know that command yet. Update the app."
        else -> "It did not work."
    }
}

/** What the phone's accessibility tree shows for one dialog: the message words, the input box, the buttons, the dialer's
 *  Call button and any "SIM 1 / SIM 2" rows. The input box's own text (where the PIN is typed) is never read. */
class UssdWindow(
    val text: String,
    val edit: AccessibilityNodeInfo?,
    val buttons: List<AccessibilityNodeInfo>,
    val callButton: AccessibilityNodeInfo?,
    val simRows: List<AccessibilityNodeInfo>,
    val positive: AccessibilityNodeInfo? = null,
    val negative: AccessibilityNodeInfo? = null,
    /** Everything on the screen that can be tapped, in the order the phone drew it. Used to pick a SIM on a phone whose
     *  chooser names the networks ("Grameenphone ... No signal") instead of "SIM 1" and "SIM 2". The words usually sit on
     *  the row's children, not the row itself, so each one's text is gathered from everything inside it. */
    val choices: List<AccessibilityNodeInfo> = emptyList(),
)

private class Collector {
    val texts = ArrayList<String>()
    var edit: AccessibilityNodeInfo? = null
    val buttons = ArrayList<AccessibilityNodeInfo>()
    var callButton: AccessibilityNodeInfo? = null
    val simRows = ArrayList<AccessibilityNodeInfo>()
    /** The dialog's own positive and negative buttons, found by their view id, for phones whose buttons carry a word
     *  PayTrace does not know (another language) or are not of class Button. */
    var positive: AccessibilityNodeInfo? = null
    var negative: AccessibilityNodeInfo? = null
    val choices = ArrayList<AccessibilityNodeInfo>()

    fun window() = UssdWindow(texts.joinToString("\n"), edit, buttons, callButton, simRows, positive, negative, choices)
}

private fun walk(n: AccessibilityNodeInfo?, c: Collector, depth: Int) {
    if (n == null || depth > 25) return
    val cls = n.className?.toString() ?: ""
    val text = n.text?.toString()
    val id = n.viewIdResourceName
    if (id != null) {
        if (c.positive == null && UssdLabels.isPositiveId(id)) c.positive = n
        if (c.negative == null && UssdLabels.isNegativeId(id)) c.negative = n
    }
    if (cls.endsWith("EditText") || n.isEditable) {
        if (c.edit == null) c.edit = n
    } else {
        // Any clickable thing with a word on it counts as a button: on some phones the dialog's Send is not of class Button.
        if (cls.endsWith("Button") || (n.isClickable && !text.isNullOrBlank())) c.buttons.add(n)
        if (n.isClickable && !cls.endsWith("Button")) c.choices.add(n)
        if (cls.endsWith("TextView") && !text.isNullOrBlank()) c.texts.add(text)
        // The dialer's Call button is an icon: found by its description, its own text or its view id (any of the three).
        if (c.callButton == null &&
            (UssdLabels.isCallButton(n.contentDescription?.toString()) || UssdLabels.isCallButton(text) || UssdLabels.isCallButtonId(n.viewIdResourceName)) &&
            (n.isClickable || n.parent?.isClickable == true)
        ) c.callButton = n
        if (UssdLabels.namesSim(text, 0) || UssdLabels.namesSim(text, 1)) c.simRows.add(n)
    }
    for (i in 0 until n.childCount) walk(n.getChild(i), c, depth + 1)
}

/** Everything written inside one node, joined: a row of the SIM chooser keeps its words on its children. */
private fun allWords(n: AccessibilityNodeInfo?, depth: Int = 0): String {
    if (n == null || depth > 6) return ""
    val mine = n.text?.toString()?.trim().orEmpty()
    val kids = StringBuilder()
    for (i in 0 until n.childCount) {
        val k = allWords(n.getChild(i), depth + 1)
        if (k.isNotBlank()) { if (kids.isNotEmpty()) kids.append(' '); kids.append(k) }
    }
    return listOf(mine, kids.toString()).filter { it.isNotBlank() }.joinToString(" ")
}

/** Tapping a row that cannot be clicked the ordinary way: the phone is asked to touch the middle of it, as a finger would.
 *  Some SIM choosers draw rows that report no click of their own. */
private fun tapOnScreen(svc: AccessibilityService?, node: AccessibilityNodeInfo?): Boolean {
    if (svc == null || node == null) return false
    return try {
        val box = android.graphics.Rect()
        node.getBoundsInScreen(box)
        if (box.width() <= 0 || box.height() <= 0) return false
        val path = android.graphics.Path().apply { moveTo(box.exactCenterX(), box.exactCenterY()) }
        val stroke = android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 60)
        svc.dispatchGesture(android.accessibilityservice.GestureDescription.Builder().addStroke(stroke).build(), null, null)
    } catch (e: Exception) {
        false
    }
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

private fun clickButton(w: UssdWindow, vararg labels: String): Boolean {
    val b = w.buttons.firstOrNull { btn -> labels.any { it.equals(btn.text?.toString()?.trim(), ignoreCase = true) } }
    if (b != null && clickUp(b)) return true
    // No button with a word PayTrace knows: use the dialog's own positive (Send) or negative (Cancel) button, found by its view id.
    val byId = when {
        labels.any { it == "send" } -> w.positive
        labels.any { it == "cancel" } -> w.negative
        else -> null
    }
    return byId != null && clickUp(byId)
}

/** One run at a time, driven by a slow clock instead of by window events: every 0.4 s it looks at the screen as it is NOW,
 *  and only acts once the screen has stopped changing, with a pause between actions. A typed reply is checked and pressed
 *  with retries; a plain reply that was ignored is said once more; the PIN is typed once and never again.
 *  Only while a run is active does it look at any window, and then only the phone's own call/USSD windows. Main thread only. */
object UssdSession {
    private const val TICK_MS = 400L
    private const val GAP_MS = 800L
    private const val TYPE_TO_SEND_MS = 500L
    private const val STUCK_MS = 7_000L
    private const val MAX_TRIES = 4
    private const val MAX_SIM_TRIES = 6
    /** How long a screen PayTrace does not know is given to finish drawing before the run gives up on it. */
    private const val UNKNOWN_WAIT_MS = 5_000L

    private class Act(val text: String, val secret: Boolean, val sig: String) {
        var typed = false
        var typedAt = 0L
        var sent = false
        var sentAt = 0L
        var tries = 0
        var retried = false
    }

    private val main = Handler(Looper.getMainLooper())
    private val tickRunnable = Runnable { tick() }
    private var flow: BalanceFlow? = null
    private var onFinish: ((UssdOutcome) -> Unit)? = null
    private var slot = 0
    private var timeout: Runnable? = null
    private var service: AccessibilityService? = null
    private var dialerPackage: String? = null
    // 0 = waiting for the dialer's Call button to be pressed; 1 = Call was pressed (or the SIM question / a menu is already showing).
    private var phase = 0
    // True once the first Nagad menu (or the SIM question) shows up; screens before that are just the dialer keypad.
    private var seenUssd = false
    private var lastSig = ""
    private var lastActionAt = 0L
    private var act: Act? = null
    private var simTries = 0
    private var pinSubmitted = false
    private var startedAt = 0L
    private var unknownSig = ""
    private var unknownSince = 0L
    private var lastText = ""
    private val trace = ArrayList<String>()
    private val noted = HashSet<String>()

    @Synchronized fun active(): Boolean = flow != null

    @Synchronized fun start(slot: Int, flow: BalanceFlow, timeoutMs: Long, dialer: String?, earlier: String, onFinish: (UssdOutcome) -> Unit) {
        this.slot = slot
        this.flow = flow
        this.onFinish = onFinish
        this.dialerPackage = dialer
        this.phase = 0
        this.seenUssd = false
        this.lastSig = ""
        this.lastActionAt = 0L
        this.act = null
        this.simTries = 0
        this.pinSubmitted = false
        this.startedAt = SystemClock.elapsedRealtime()
        this.unknownSig = ""
        this.unknownSince = 0L
        this.lastText = ""
        trace.clear()
        noted.clear()
        if (earlier.isNotBlank()) trace.addAll(earlier.lines().take(40))
        val t = Runnable { finish(UssdOutcome(false, null, "timeout")) }
        timeout = t
        main.postDelayed(t, timeoutMs)
        main.postDelayed(tickRunnable, TICK_MS)
    }

    fun attach(s: AccessibilityService?) { service = s }

    /** True while the dialer is waiting for its Call button to be pressed. */
    @Synchronized fun stillDialing(): Boolean = flow != null && phase == 0

    /** The accessibility service's own context, which Android lets open screens more freely than a background service. */
    fun launchContext(): Context? = service

    /** Only the phone's own call and menu windows may be read: the system ones, plus the phone's chosen dialer app. */
    fun allowedPackage(pkg: String): Boolean =
        pkg == "com.android.phone" || pkg == "com.android.server.telecom" || pkg == "com.android.contacts" ||
            pkg.contains("incallui") || pkg.contains("dialer") || pkg.contains("telecom") ||
            (dialerPackage != null && pkg == dialerPackage)

    fun note(msg: String) {
        if (trace.size < 60) trace.add(String.format(Locale.US, "%4.1fs %s", (SystemClock.elapsedRealtime() - startedAt) / 1000.0, msg))
    }

    private fun noteOnce(key: String, msg: String) { if (noted.add(key)) note(msg) }

    private fun tick() {
        if (!active()) return
        main.postDelayed(tickRunnable, TICK_MS)
        try {
            step()
        } catch (e: Exception) {
            noteOnce("err" + e.javaClass.simpleName, "problem: " + e.javaClass.simpleName)
        }
    }

    /** Every window on the screen that belongs to the phone's own call or menu apps, not only the one Android calls "active":
     *  on many phones the USSD dialog is drawn over the dialer and is not the active window, which is why a run could sit
     *  there doing nothing. Of the windows found, the menu is picked: the one the flow recognises, else the one with a box
     *  to type in, else the wordiest. */
    private fun readScreen(svc: AccessibilityService): UssdWindow? {
        val roots = ArrayList<AccessibilityNodeInfo>()
        try {
            for (win in svc.windows) {
                val r = try { win.root } catch (e: Exception) { null }
                if (r != null) roots.add(r)
            }
        } catch (e: Exception) {
            // Some phones refuse the window list; the active window alone has to do.
        }
        svc.rootInActiveWindow?.let { roots.add(it) }
        val f = flow
        var best: UssdWindow? = null
        var bestScore = -1
        for (r in roots) {
            val pkg = r.packageName?.toString() ?: continue
            val c = Collector()
            walk(r, c, 0)
            val w = c.window()
            if (w.text.isBlank() && w.edit == null && w.callButton == null) continue
            val asksSim = UssdLabels.asksWhichSim(w.text)
            // Normally only the phone's own call and menu windows are read. The dialog that asks which SIM to call with can
            // come from another part of the phone on some brands, so a window that IS that question is read as well: it is
            // the one thing a run cannot get past on its own, and nothing is done with it but tapping the chosen SIM.
            if (!allowedPackage(pkg) && !asksSim) continue
            if (!allowedPackage(pkg)) noteOnce("simpkg", "the SIM question belongs to " + pkg)
            val score = (if (f != null && f.recognises(w.text)) 9000 else 0) +
                (if (asksSim) 9000 else 0) +
                (if (w.edit != null) 1000 else 0) + w.text.length.coerceAtMost(900)
            if (score > bestScore) { bestScore = score; best = w }
        }
        return best
    }

    private fun step() {
        val svc = service ?: return
        val w = readScreen(svc) ?: return
        val sig = w.text + "|" + (if (w.callButton != null) "C" else "") + (if (w.edit != null) "E" else "") + (if (w.simRows.isNotEmpty()) "S" else "")
        if (sig.length <= 3) return
        if (w.text.isNotBlank()) lastText = w.text
        // Wait until the screen has stopped changing before touching it.
        if (sig != lastSig) { lastSig = sig; return }
        if (SystemClock.elapsedRealtime() - lastActionAt < GAP_MS) return
        evaluate(w, sig)
    }

    /** A screen whose words PayTrace does not know yet. While a dialog is still being drawn it reads like this, so it is given
     *  [UNKNOWN_WAIT_MS] to settle before the run gives up on it. Returns true when the run should wait and look again. */
    private fun waitForUnknown(sig: String, text: String, now: Long): Boolean {
        if (unknownSig != sig) { unknownSig = sig; unknownSince = now; return true }
        if (now - unknownSince < UNKNOWN_WAIT_MS) return true
        noteOnce("unknown" + sig.hashCode(), "screen not recognised: " + UssdRedact.snippet(text))
        return false
    }

    private fun evaluate(w: UssdWindow, sig: String) {
        val f = synchronized(this) { flow } ?: return
        val now = SystemClock.elapsedRealtime()
        val lower = w.text.lowercase()
        val chooser = UssdLabels.asksWhichSim(w.text)
        val ussdScreen = f.recognises(w.text)
        // The dialer is open with *167# typed in: press its Call button, as a person does. Looked for again on every tick.
        if (phase == 0) {
            if (!chooser && !ussdScreen) {
                val btn = w.callButton
                if (btn == null) { noteOnce("nocall", "dialer open, looking for the Call button [" + UssdRedact.snippet(w.text, 60) + "]"); return }
                if (clickUp(btn)) { note("Call pressed"); phase = 1; lastActionAt = now }
                return
            }
            phase = 1
        }
        // "Choose SIM for this call": tap the SIM picked in settings.
        if (chooser) {
            simTries++
            // Written down once, so a chooser PayTrace cannot work out can be read afterwards (no long numbers).
            noteOnce("chooser", "SIM question: " + UssdRedact.snippet(w.text))
            // First a row that names the SIM ("SIM 2", "SIM2 +880 ..."). Failing that, the rows of the dialog in the order
            // the phone drew them, which is SIM 1 then SIM 2 on every chooser seen so far; only when there are exactly two,
            // so a one-off dialog can never be tapped by position.
            // The Vivo writes "SIM1 +880 ..." on the row itself; the Redmi writes "Grameenphone", the number and "No signal"
            // on the row's children, so each row's words are gathered from everything inside it.
            val nodes = if (w.simRows.isNotEmpty()) w.simRows else w.choices.filter { UssdLabels.isChoice(allWords(it)) }
            val rows = nodes.map { SimRow(allWords(it), it.isEnabled) }
            when (val pick = UssdSimPick.choose(rows, slot)) {
                is UssdSimPick.Pick.Tap -> {
                    val row = nodes[pick.index]
                    // The ordinary way first; if the row reports no click of its own, touch the middle of it instead.
                    if (clickUp(row)) {
                        note("SIM " + (slot + 1) + " tapped")
                        lastActionAt = now
                        return
                    }
                    if (tapOnScreen(service, row)) {
                        note("SIM " + (slot + 1) + " touched on screen")
                        lastActionAt = now
                        return
                    }
                }
                is UssdSimPick.Pick.Stop -> {
                    note("SIM " + (slot + 1) + " is grey on this screen: " + UssdRedact.snippet(w.text))
                    finish(UssdOutcome(false, null, pick.reason))
                    return
                }
                is UssdSimPick.Pick.Wait -> Unit
            }
            if (simTries >= MAX_SIM_TRIES) {
                note("could not pick the SIM on this screen: " + UssdRedact.snippet(w.text))
                finish(UssdOutcome(false, null, "sim_not_found"))
            }
            return
        }
        // The phone's own refusal of the code.
        if (lower.contains("connection problem") || lower.contains("invalid mmi")) { note("phone refused the code"); finish(UssdOutcome(false, null, "dial_failed")); return }
        // The provider's own refusal ("service is not available at the moment, please try again later").
        if (lower.contains("not available") || lower.contains("try again later")) { note("provider said the service is not available"); finish(UssdOutcome(false, null, "network_refused")); return }
        // Until the first menu appears, what is on the screen is only the dialer's keypad: wait for the menu.
        if (ussdScreen) {
            seenUssd = true
            unknownSince = 0L
            unknownSig = ""
        } else {
            if (!seenUssd) return
            if (waitForUnknown(sig, w.text, now)) return
        }
        // An answer already under way for this very screen: keep going with it (type, press Send, wait).
        val under = act
        if (under != null) {
            if (under.sig == sig) { continueAct(under, w); return }
            act = null // the screen changed, so the answer was taken
        }
        when (val a = f.onScreen(w.text)) {
            is UssdAction.Wait -> Unit
            is UssdAction.Reply -> {
                val fresh = Act(a.text, a.secret, sig)
                act = fresh
                note(if (a.secret) "menu: typing the PIN" else "menu: typing " + a.text)
                continueAct(fresh, w)
            }
            is UssdAction.Done -> { note("balance read"); finish(UssdOutcome(true, a.balance, null)) }
            is UssdAction.Fail -> { note("stopped: " + a.reason + " [" + UssdRedact.snippet(w.text) + "]"); finish(UssdOutcome(false, null, a.reason)) }
        }
    }

    private fun continueAct(a: Act, w: UssdWindow) {
        val now = SystemClock.elapsedRealtime()
        if (a.sent) {
            // Waiting for the phone's answer. A plain reply that was ignored for a while is said once more; the PIN never is.
            if (!a.secret && !a.retried && now - a.sentAt > STUCK_MS) {
                a.retried = true; a.typed = false; a.sent = false; a.tries = 0
                note("no answer, saying it again")
            }
            return
        }
        if (!a.typed) {
            val edit = w.edit
            val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, a.text) }
            if (edit != null && edit.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
                a.typed = true; a.typedAt = now; lastActionAt = now
            } else if (++a.tries >= MAX_TRIES) {
                note("could not type"); finish(UssdOutcome(false, null, "no_input_box"))
            }
            return
        }
        // A short pause so the dialog accepts the typed text before Send is pressed.
        if (now - a.typedAt < TYPE_TO_SEND_MS) return
        if (clickButton(w, "send", "ok", "reply", "submit", "continue")) {
            a.sent = true; a.sentAt = now; lastActionAt = now
            if (a.secret) pinSubmitted = true
            note("sent")
        } else if (++a.tries >= MAX_TRIES) {
            note("could not press Send"); finish(UssdOutcome(false, null, "no_send_button"))
        }
    }

    fun abort(error: String) = finish(UssdOutcome(false, null, error))

    private fun finish(outcome0: UssdOutcome) {
        // So a failed run can be read later: what was last on the screen, with every long number hidden.
        if (!outcome0.ok && lastText.isNotBlank()) noteOnce("last", "last screen: " + UssdRedact.snippet(lastText))
        val cb: ((UssdOutcome) -> Unit)?
        val sent: Boolean
        synchronized(this) {
            if (flow == null) return
            flow = null
            cb = onFinish
            onFinish = null
            sent = pinSubmitted
            timeout?.let { main.removeCallbacks(it) }
            timeout = null
            main.removeCallbacks(tickRunnable)
        }
        // A timeout after the PIN went in is a different, more careful message: nothing is retried by itself.
        val error = if (outcome0.error == "timeout" && sent) "no_answer_after_pin" else outcome0.error
        val outcome = outcome0.copy(error = error, pinSent = sent, trace = trace.joinToString("\n"))
        // Close the menu the phone left open, then go back to the home screen.
        main.post {
            try {
                val root = service?.rootInActiveWindow
                if (root != null && allowedPackage(root.packageName?.toString() ?: "")) {
                    val c = Collector()
                    walk(root, c, 0)
                    clickButton(c.window(), "cancel", "dismiss", "ok", "close")
                }
            } catch (e: Exception) {
                // Best effort: the run is over either way.
            }
            main.postDelayed({ try { service?.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME) } catch (e: Exception) { } }, 500)
        }
        cb?.invoke(outcome)
    }
}

/** The service the owner switches on once per phone in Accessibility settings. All the work is done by [UssdSession]'s own
 *  clock while a run is active; this class only has to be switched on and bound. */
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
        // Nothing to do per event: the session reads the screen itself, on its own clock.
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

    /** Where each wallet's PIN is kept: encrypted, on this phone only. */
    fun pinStore(ctx: Context, provider: String): SecretStore =
        SecretStore(ctx.applicationContext, if (provider == UssdProviders.BKASH) "ussd_pin_bkash" else "ussd_pin")

    fun pinSaved(ctx: Context, provider: String = UssdProviders.NAGAD): Boolean = pinStore(ctx, provider).get().isNotEmpty()
}

/** Runs a balance check for one wallet (Nagad or bKash). First choice is the direct way ([UssdApi]: no dialer, no buttons, the answer
 *  comes back as text): Nagad as one code, bKash one menu at a time. If the phone cannot do that, the dialer way is used: open the
 *  dialer with the provider's code typed in and let [UssdSession] press Call, pick the SIM and walk the menus. Everything is checked
 *  first; the PIN is read from the encrypted store only now and kept in memory for this run. A failed dialer try before the PIN was
 *  really submitted is tried once more; after the PIN, never. */
object UssdRunner {
    /** The phone's own name for the SIM in [slot]. Putting it on the call means the phone does NOT ask which SIM to use:
     *  the chooser never appears, which is the step every brand words differently. Null when it cannot be worked out, and
     *  then the chooser is answered as before. */
    @Suppress("DEPRECATION")
    private fun simAccount(app: Context, slot: Int): android.telecom.PhoneAccountHandle? {
        return try {
            if (ContextCompat.checkSelfPermission(app, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null
            val sm = app.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as android.telephony.SubscriptionManager
            val info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot) ?: return null
            val tm = app.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
            val mine = tm.callCapablePhoneAccounts
            // Most phones name the handle after the subscription; otherwise the handles come in SIM order.
            mine.firstOrNull { it.id == info.subscriptionId.toString() }
                ?: (if (mine.size == 2) mine.getOrNull(slot) else null)
        } catch (e: Exception) {
            null
        }
    }

    /** Puts the chosen SIM on an intent, where the phone allows it. */
    private fun withSim(intent: Intent, app: Context, slot: Int): Intent {
        val account = simAccount(app, slot)
        if (account != null) {
            intent.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, account)
            UssdSession.note("call set to SIM " + (slot + 1) + ", so the phone should not ask")
        }
        return intent
    }

    private const val RUN_MS = 90_000L
    private const val DIAL_FALLBACK_MS = 3_500L
    private const val RETRY_PAUSE_MS = 4_000L
    /** After a bKash session was opened by the direct way and could not go on, let the network drop it before the dialer way starts. */
    private const val SWITCH_PAUSE_MS = 4_000L
    /** After switching PayTrace back on in Accessibility settings, the time Android needs to start the service. */
    private const val HEAL_PAUSE_MS = 2_500L

    fun run(ctx: Context, provider: String, onFinish: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        fun go() = attempt(app, provider, 1, "") { outcome -> onFinish(afterRun(app, outcome)) }
        // An app update switches PayTrace off in Accessibility settings. Where the phone lets it, put it back first and give
        // Android a moment to start the service before the dialer way needs it.
        if (AccessibilityHeal.heal(app)) Handler(Looper.getMainLooper()).postDelayed({ go() }, HEAL_PAUSE_MS) else go()
    }

    /** A phone whose modem will not send a balance code from an app (the owner's Vivo: "failure code -1", or the network's
     *  "try again later", while the same code dialed by hand works) moves itself to the dialer way, rather than failing every
     *  time until someone notices. It says so in the run's own log, and Settings still lets it be moved back by hand. */
    private fun afterRun(app: Context, outcome: UssdOutcome): UssdOutcome {
        val s = AppSettings(app)
        if (s.ussdDialerWay) return outcome
        val fails = UssdDirectHealth.count(s.ussdDirectFails, outcome.trace, outcome.ok)
        s.ussdDirectFails = fails
        if (!UssdDirectHealth.shouldSwitch(fails, UssdSetup.accessibilityOn(app))) return outcome
        s.ussdDialerWay = true
        s.ussdDirectFails = 0
        val line = "this phone cannot send the code from the app, so it has moved itself to the dialer way"
        return outcome.copy(trace = (outcome.trace + "\n" + line).trim())
    }

    private fun attempt(app: Context, provider: String, n: Int, earlier: String, onFinish: (UssdOutcome) -> Unit) {
        val s = AppSettings(app)
        fun fail(e: String) = onFinish(UssdOutcome(false, null, e, trace = earlier))
        if (!UssdProviders.isKnown(provider)) return fail("unsupported")
        if (!s.ussdAllowed) return fail("not_allowed")
        if (!UssdSetup.callPermission(app)) return fail("no_call_permission")
        val pin = UssdSetup.pinStore(app, provider).get()
        if (pin.isEmpty()) return fail("no_pin")
        if (UssdSession.active() || UssdApi.active()) return fail("busy")
        val slot = s.ussdSlotOf(provider)
        if (n == 1) {
            if (UssdApi.tooSoon()) return fail("too_soon")
            if (!s.ussdDialerWay && UssdApi.available(app)) {
                if (UssdProviders.oneCode(provider)) {
                    UssdApi.run(app, slot, pin, onFinish) { viaDialer(app, provider, 1, "", onFinish, s, pin) }
                } else {
                    UssdApi.runSteps(app, slot, UssdProviders.flow(provider) { pin }, UssdProviders.dialCode(provider), onFinish) { trace ->
                        Handler(Looper.getMainLooper()).postDelayed({ viaDialer(app, provider, 1, trace, onFinish, s, pin) }, SWITCH_PAUSE_MS)
                    }
                }
                return
            }
        }
        viaDialer(app, provider, n, earlier, onFinish, s, pin)
    }

    @Suppress("DEPRECATION")
    private fun viaDialer(app: Context, provider: String, n: Int, earlier: String, onFinish: (UssdOutcome) -> Unit, s: AppSettings, pin: String) {
        fun fail(e: String) = onFinish(UssdOutcome(false, null, e, trace = earlier))
        if (!UssdSetup.accessibilityOn(app)) return fail("no_accessibility")
        if (UssdSession.active()) return fail("busy")
        val code = UssdProviders.dialCode(provider)
        // The phone's own dialer, so the right app opens whatever the brand or the home screen looks like.
        val dialer = try { (app.getSystemService(Context.TELECOM_SERVICE) as TelecomManager).defaultDialerPackage } catch (e: Exception) { null }
        val head = if (n > 1) earlier + "\n-- second try --" else earlier
        UssdSession.start(s.ussdSlotOf(provider), UssdProviders.flow(provider) { pin }, RUN_MS, dialer, head) { outcome ->
            if (UssdRetry.shouldRetry(outcome.error, outcome.ok, outcome.pinSent, n)) {
                Handler(Looper.getMainLooper()).postDelayed({ attempt(app, provider, n + 1, outcome.trace, onFinish) }, RETRY_PAUSE_MS)
            } else {
                onFinish(outcome)
            }
        }
        UssdSession.note("start, dialer way, " + UssdProviders.label(provider) + ", try " + n + (if (dialer != null) ", dialer " + dialer else ""))
        try {
            // The phone's screen may be off: wake it so the menu can be shown.
            val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "paytrace:ussd").acquire(RUN_MS + 5_000)
        } catch (e: Exception) {
            // The call may still work with the screen on.
        }
        val opener = UssdSession.launchContext() ?: app
        val dial = withSim(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(code))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), app, s.ussdSlotOf(provider))
        try {
            if (dialer != null) dial.setPackage(dialer)
            opener.startActivity(dial)
            UssdSession.note("dialer opened")
        } catch (e: Exception) {
            try {
                dial.setPackage(null)
                opener.startActivity(dial)
                UssdSession.note("dialer opened (any dialer)")
            } catch (e2: Exception) {
                UssdSession.abort("dial_failed")
                return
            }
        }
        val slotNow = s.ussdSlotOf(provider)
        // If the Call button was not found and pressed in a few seconds, place the call directly instead (same result, no keypad).
        Handler(Looper.getMainLooper()).postDelayed({
            if (UssdSession.stillDialing()) {
                UssdSession.note("no Call button found, placing the call directly")
                try {
                    (UssdSession.launchContext() ?: app).startActivity(
                        withSim(Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(code))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), app, slotNow),
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
        val provider = cmd.optString("provider")
        if (cmd.optString("kind") != "balance" || !UssdProviders.isKnown(provider)) {
            report(ctx, id, UssdOutcome(false, null, "unsupported"))
            return
        }
        UssdRunner.run(ctx, provider) { outcome ->
            remember(ctx, provider, outcome)
            report(ctx, id, outcome)
        }
    }

    /** Kept on the phone so the Settings card can show the last result of each wallet. */
    fun remember(ctx: Context, provider: String, o: UssdOutcome) {
        val j = JSONObject().put("at", System.currentTimeMillis()).put("ok", o.ok)
        if (o.balance != null) j.put("balance", o.balance)
        if (o.error != null) j.put("error", o.error)
        if (o.trace.isNotBlank()) j.put("trace", o.trace.take(2500))
        AppSettings(ctx).setUssdLastOf(provider, j.toString())
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

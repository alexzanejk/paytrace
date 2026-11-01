package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/** The direct way: Android's own USSD request (TelephonyManager.sendUssdRequest). One code goes out with the PIN inside and the
 *  network's answer comes back as text. No dialer, no buttons, no SIM pop-up and no Accessibility, so it behaves the same on
 *  every phone, with the screen off, and from a dashboard command in the background. It needs only the phone-call permission
 *  (and the SIM permission to pick the right SIM on a dual-SIM phone).
 *
 *  Safety: the PIN is part of the one code, sent once. If anything goes wrong after the code was handed to the phone, nothing
 *  is tried again. The dialer way is only used when the phone could not start the request at all. The code is never logged. */
object UssdApi {
    private const val ANSWER_MS = 45_000L
    /** How long the phone needs to write the answer into its radio log before PayTrace looks there. */
    private const val LOG_PAUSE_MS = 1_500L
    private val main = Handler(Looper.getMainLooper())
    private val running = AtomicBoolean(false)
    @Volatile private var lastFinishAt = 0L

    fun active(): Boolean = running.get()

    fun tooSoon(): Boolean = UssdDirect.tooSoon(lastFinishAt, SystemClock.elapsedRealtime())

    fun available(ctx: Context): Boolean = Build.VERSION.SDK_INT >= 26 && UssdSetup.callPermission(ctx)

    private fun simPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    /** The phone's telephony service for the chosen SIM (0 = SIM 1, 1 = SIM 2); the default one when that cannot be told. */
    private fun telephonyFor(ctx: Context, slot: Int): TelephonyManager {
        val base = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        if (!simPermission(ctx)) return base
        return try {
            val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot)
            if (info != null) base.createForSubscriptionId(info.subscriptionId) else base
        } catch (e: Exception) {
            base
        }
    }

    /** Sends the code. Returns after handing it over; [onDone] gets the result later. When the phone could not start the request
     *  (nothing was sent) [onNotSent] is called instead, so the caller may use the dialer way. */
    fun run(ctx: Context, slot: Int, pin: String, onDone: (UssdOutcome) -> Unit, onNotSent: () -> Unit) {
        val code = NagadUssd.balanceCode(pin)
        if (code == null) { onDone(UssdOutcome(false, null, "no_pin", trace = "the saved PIN is not 4 to 8 digits")); return }
        if (!running.compareAndSet(false, true)) { onDone(UssdOutcome(false, null, "busy")); return }
        val started = SystemClock.elapsedRealtime()
        val trace = ArrayList<String>()
        fun note(msg: String) {
            if (trace.size < 20) trace.add(String.format(java.util.Locale.US, "%4.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, msg))
        }
        val finished = AtomicBoolean(false)
        fun finish(o: UssdOutcome) {
            if (!finished.compareAndSet(false, true)) return
            lastFinishAt = SystemClock.elapsedRealtime()
            running.set(false)
            onDone(o.copy(pinSent = true, trace = trace.joinToString("\n")))
        }
        // The wallet's answer keeps its menu open, so Android will not pass it to an app (see UssdLog). On a phone that was
        // given READ_LOGS, the words are still in the radio log: empty it first, then look there when Android says no.
        val readsLog = UssdLogs.allowed(ctx)
        if (readsLog) { UssdLogs.clear(); note("the phone log will be read if Android refuses the answer") }
        fun fromLog(fallback: String) {
            if (finished.get()) return
            if (!readsLog) { finish(UssdOutcome(false, null, fallback)); return }
            // The log is written a moment after the answer arrives.
            main.postDelayed({
                if (finished.get()) return@postDelayed
                val b = try { UssdLogRead.balanceIn(UssdLogs.lines(), NagadUssd::balanceOnly) } catch (e: Exception) { null }
                if (b != null) { note("balance read from the phone log"); finish(UssdOutcome(true, b, null)) }
                else { note("the phone log had no balance either"); finish(UssdOutcome(false, null, fallback)) }
            }, LOG_PAUSE_MS)
        }
        fun notSent(why: String) {
            if (!finished.compareAndSet(false, true)) return
            running.set(false)
            UssdSession.note("direct way unavailable: $why")
            onNotSent()
        }
        note("direct USSD request, SIM " + (slot + 1))
        try {
            val tm = telephonyFor(ctx, slot)
            tm.sendUssdRequest(code, object : TelephonyManager.UssdResponseCallback() {
                override fun onReceiveUssdResponse(telephonyManager: TelephonyManager, request: String, response: CharSequence) {
                    val text = response.toString()
                    when (val a = UssdDirect.readReply(text)) {
                        is UssdAction.Done -> { note("balance read"); finish(UssdOutcome(true, a.balance, null)) }
                        is UssdAction.Fail -> {
                            // The answer is not a balance. Show its first words (never the code) so the cause can be seen.
                            note("answer was not a balance: " + text.replace(Regex("\\s+"), " ").take(100))
                            finish(UssdOutcome(false, null, a.reason))
                        }
                        else -> finish(UssdOutcome(false, null, "unexpected_screen"))
                    }
                }

                override fun onReceiveUssdResponseFailed(telephonyManager: TelephonyManager, request: String, failureCode: Int) {
                    note("phone reported failure code $failureCode")
                    if (UssdDirect.nothingWasSent(failureCode)) notSent("service unavailable")
                    else fromLog(UssdDirect.failureError(failureCode))
                }
            }, main)
            note("request handed to the phone")
        } catch (e: SecurityException) {
            notSent("no permission")
            return
        } catch (e: Exception) {
            notSent(e.javaClass.simpleName)
            return
        }
        // If the network never answers, say so; the PIN was already sent, so it is not tried again.
        main.postDelayed({ note("network never answered"); fromLog("no_answer_after_pin") }, ANSWER_MS)
    }

    /** The same direct way for a wallet that cannot take one long code (bKash): send the first code, read the menu the network sends
     *  back, answer with the next menu number, and so on until the PIN prompt, then the PIN once, then the balance. Each answer is
     *  decided by [flow], which only ever answers a screen it expects.
     *
     *  Whether Android lets a second request continue the open menu session depends on the phone and the network. If any request
     *  fails BEFORE the PIN was handed over, nothing secret was sent and [onNotSent] is called (with the step log) so the caller can
     *  use the dialer way. Once the PIN was handed over nothing is ever tried again. */
    fun runSteps(
        ctx: Context, slot: Int, flow: BalanceFlow, firstCode: String,
        onDone: (UssdOutcome) -> Unit, onNotSent: (String) -> Unit,
    ) {
        if (!running.compareAndSet(false, true)) { onDone(UssdOutcome(false, null, "busy")); return }
        val started = SystemClock.elapsedRealtime()
        val trace = ArrayList<String>()
        fun note(msg: String) {
            if (trace.size < 30) trace.add(String.format(java.util.Locale.US, "%4.1fs %s", (SystemClock.elapsedRealtime() - started) / 1000.0, msg))
        }
        fun preview(text: String): String = text.replace(Regex("\\s+"), " ").take(100)
        val finished = AtomicBoolean(false)
        val pinHandedOver = AtomicBoolean(false)
        fun finish(o: UssdOutcome) {
            if (!finished.compareAndSet(false, true)) return
            lastFinishAt = SystemClock.elapsedRealtime()
            running.set(false)
            onDone(o.copy(pinSent = pinHandedOver.get(), trace = trace.joinToString("\n")))
        }
        fun fallBack(why: String) {
            if (!finished.compareAndSet(false, true)) return
            running.set(false)
            note("direct way could not go on: $why")
            onNotSent(trace.joinToString("\n"))
        }
        val tm = try { telephonyFor(ctx, slot) } catch (e: Exception) { running.set(false); onNotSent("direct way unavailable: no telephony service"); return }
        note("direct menu walk, SIM " + (slot + 1))

        fun send(text: String, secret: Boolean) {
            if (finished.get()) return
            if (secret) pinHandedOver.set(true)
            try {
                tm.sendUssdRequest(text, object : TelephonyManager.UssdResponseCallback() {
                    override fun onReceiveUssdResponse(telephonyManager: TelephonyManager, request: String, response: CharSequence) {
                        val reply = response.toString()
                        val lower = reply.lowercase()
                        if (lower.contains("not available") || lower.contains("try again later")) {
                            note("provider said the service is not available")
                            finish(UssdOutcome(false, null, "network_refused"))
                            return
                        }
                        when (val a = flow.onScreen(reply)) {
                            is UssdAction.Done -> { note("balance read"); finish(UssdOutcome(true, a.balance, null)) }
                            is UssdAction.Reply -> {
                                note(if (a.secret) "got the PIN prompt, answering it" else "got a menu, answering " + a.text)
                                send(a.text, a.secret)
                            }
                            is UssdAction.Fail -> { note("unexpected answer: " + preview(reply)); finish(UssdOutcome(false, null, a.reason)) }
                            is UssdAction.Wait -> { note("unexpected answer: " + preview(reply)); finish(UssdOutcome(false, null, "unexpected_screen")) }
                        }
                    }

                    override fun onReceiveUssdResponseFailed(telephonyManager: TelephonyManager, request: String, failureCode: Int) {
                        note("phone reported failure code $failureCode")
                        if (pinHandedOver.get()) finish(UssdOutcome(false, null, UssdDirect.failureError(failureCode))) else fallBack("failure code $failureCode")
                    }
                }, main)
            } catch (e: Exception) {
                // The request was not accepted by the phone, so nothing was sent (not even the PIN).
                if (secret) pinHandedOver.set(false)
                fallBack(e.javaClass.simpleName)
            }
        }

        send(firstCode, false)
        main.postDelayed({
            if (pinHandedOver.get()) finish(UssdOutcome(false, null, "no_answer_after_pin")) else fallBack("no answer from the network")
        }, STEPS_ANSWER_MS)
    }

    private const val STEPS_ANSWER_MS = 60_000L
}

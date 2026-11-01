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
                    if (UssdDirect.nothingWasSent(failureCode)) notSent("service unavailable") else finish(UssdOutcome(false, null, UssdDirect.failureError(failureCode)))
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
        main.postDelayed({ finish(UssdOutcome(false, null, "no_answer_after_pin")) }, ANSWER_MS)
    }
}

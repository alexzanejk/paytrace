package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicBoolean

/** Bangladesh mobile numbers as people type them, and as networks print them. Pure, tested. */
object PhoneNumbers {
    private val DIGITS = Regex("[^0-9]")

    /** "+880 17 1234-5678", "8801712345678", "01712345678" all become "01712345678". Null when it is not an 11-digit 01 number. */
    fun normalize(raw: String?): String? {
        if (raw == null) return null
        var d = raw.replace(DIGITS, "")
        if (d.startsWith("880") && d.length == 13) d = "0" + d.substring(3)
        return if (d.length == 11 && d.startsWith("01")) d else null
    }

    /** Every 11-digit 01 number (or +880 form) found in a network's answer, normalised. */
    fun inText(text: String?): List<String> {
        if (text.isNullOrBlank()) return emptyList()
        return Regex("(?:\\+?880|0)1[0-9](?:[ \\-]?[0-9]){8}").findAll(text).mapNotNull { normalize(it.value) }.distinct().toList()
    }
}

/** The operator's own "what is my number" USSD codes, in the order to try them, chosen from the carrier name Android
 *  reports for a SIM. From public guides (none official): GP *2# then *111*8#; Robi *2# or *140*2*4#; Airtel *121*7*3#
 *  then *2#; Banglalink *511# then *666#; Teletalk *551#. *2# is a read-only "my number" code on every Bangladeshi
 *  operator, so an operator Android cannot name gets that one alone. A code that answers with anything but a number
 *  simply finds nothing and the next one is tried; the person can always pick the SIM by hand instead. */
object OwnNumberCodes {
    fun codesFor(carrier: String?): List<String> {
        val c = carrier?.lowercase()?.trim().orEmpty()
        return when {
            c.contains("grameen") || c == "gp" || c.startsWith("gp ") -> listOf("*2#", "*111*8#")
            c.contains("robi") -> listOf("*140*2*4#", "*2#")
            c.contains("airtel") -> listOf("*121*7*3#", "*2#")
            c.contains("banglalink") || c == "bl" -> listOf("*511#", "*666#")
            c.contains("teletalk") -> listOf("*551#")
            else -> listOf("*2#")
        }
    }

    /** The first code to try. */
    fun codeFor(carrier: String?): String = codesFor(carrier).first()
}

/** What the finder learned about each SIM slot: the number if any way gave one. */
data class SimSeen(val slot: Int, val carrier: String, val number: String?)

sealed class SimFind {
    data class Found(val slot: Int, val carrier: String) : SimFind()
    data class NotFound(val seen: List<SimSeen>) : SimFind()
    object NoPermission : SimFind()
}

/** Which SIM holds a wallet's number. First the numbers Android itself knows for each SIM (often empty on Bangladeshi SIMs),
 *  then, SIM by SIM, the operator's own "my number" code sent as a direct USSD request (its answer closes the session, so
 *  Android passes it to the app, unlike a wallet menu). The person can always pick by hand instead. */
object SimFinder {
    private const val ANSWER_MS = 20_000L
    private const val NEXT_CODE_PAUSE_MS = 2_500L
    // Lazy on purpose: the pure helpers (match, hide) are unit tested on a plain JVM, where Android's Looper does not exist,
    // and an eager Handler here made the whole object fail to load there (build 137).
    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val running = AtomicBoolean(false)

    /** Pure: the slot whose number equals the wanted one. */
    fun match(wanted: String?, seen: List<SimSeen>): Int? {
        val w = PhoneNumbers.normalize(wanted) ?: return null
        return seen.firstOrNull { it.number == w }?.slot
    }

    private fun has(ctx: Context, perm: String) = ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    /** The number Android has on record for a subscription, by every way a version of Android offers. Null when none. */
    private fun androidNumber(ctx: Context, sm: SubscriptionManager, tm: TelephonyManager, info: android.telephony.SubscriptionInfo): String? {
        val tries = ArrayList<String?>()
        if (Build.VERSION.SDK_INT >= 33) {
            try { tries.add(sm.getPhoneNumber(info.subscriptionId)) } catch (e: Exception) { }
        }
        try { @Suppress("DEPRECATION") tries.add(info.number) } catch (e: Exception) { }
        try { @Suppress("MissingPermission", "HardwareIds") tries.add(tm.createForSubscriptionId(info.subscriptionId).line1Number) } catch (e: Exception) { }
        return tries.firstNotNullOfOrNull { PhoneNumbers.normalize(it) }
    }

    /** Finds the SIM for [wanted]. [onDone] is called once on the main thread. [note] receives short progress lines (never a PIN:
     *  there is none here). */
    fun find(ctx: Context, wanted: String, note: (String) -> Unit, onDone: (SimFind) -> Unit) {
        val want = PhoneNumbers.normalize(wanted)
        if (want == null) { onDone(SimFind.NotFound(emptyList())); return }
        if (!has(ctx, Manifest.permission.READ_PHONE_STATE)) { onDone(SimFind.NoPermission); return }
        if (!running.compareAndSet(false, true)) { onDone(SimFind.NotFound(emptyList())); return }
        fun done(r: SimFind) { running.set(false); main.post { onDone(r) } }
        val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
        val tm = ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        val subs = try { @Suppress("MissingPermission") (sm.activeSubscriptionInfoList ?: emptyList()) } catch (e: Exception) { emptyList() }
        if (subs.isEmpty()) { note("Android lists no SIM"); done(SimFind.NotFound(emptyList())); return }

        // 1. What Android already knows.
        val seen = subs.map { SimSeen(it.simSlotIndex, it.carrierName?.toString().orEmpty(), androidNumber(ctx, sm, tm, it)) }.toMutableList()
        seen.forEach { note("SIM ${it.slot + 1} (${it.carrier.ifEmpty { "unknown operator" }}): " + (it.number?.let { n -> "Android knows " + hide(n) } ?: "Android has no number")) }
        match(want, seen)?.let { slot -> done(SimFind.Found(slot, seen.first { it.slot == slot }.carrier)); return }

        // 2. Ask each operator, one SIM at a time. Only slots Android gave no number for, with a known code, and only when
        //    no wallet check is using the phone's USSD channel right now.
        if (Build.VERSION.SDK_INT < 26 || !has(ctx, Manifest.permission.CALL_PHONE)) { note("cannot ask the operator: no phone permission"); done(SimFind.NotFound(seen)); return }
        if (UssdApi.active()) { note("a balance check is running; try again in a minute"); done(SimFind.NotFound(seen)); return }
        val queue = ArrayDeque(subs.filter { s -> seen.first { it.slot == s.simSlotIndex }.number == null })
        fun next() {
            val info = queue.removeFirstOrNull() ?: run { done(SimFind.NotFound(seen)); return }
            val carrier = info.carrierName?.toString().orEmpty()
            val codes = OwnNumberCodes.codesFor(carrier)
            val tm1 = try { tm.createForSubscriptionId(info.subscriptionId) } catch (e: Exception) { tm }
            fun tryCode(i: Int) {
                if (i >= codes.size) { note("SIM ${info.simSlotIndex + 1}: none of its codes gave a number"); next(); return }
                val code = codes[i]
                val finished = AtomicBoolean(false)
                fun got(number: String?, why: String) {
                    if (!finished.compareAndSet(false, true)) return
                    if (number != null) {
                        val k = seen.indexOfFirst { it.slot == info.simSlotIndex }
                        if (k >= 0) seen[k] = seen[k].copy(number = number)
                        note("SIM ${info.simSlotIndex + 1}: ${carrier.ifEmpty { "the operator" }} says " + hide(number))
                        if (number == want) done(SimFind.Found(info.simSlotIndex, carrier)) else next()
                    } else {
                        note("SIM ${info.simSlotIndex + 1}: $code gave nothing ($why)")
                        // The network keeps a short session after an answer; a breath before the next code.
                        main.postDelayed({ tryCode(i + 1) }, NEXT_CODE_PAUSE_MS)
                    }
                }
                note("SIM ${info.simSlotIndex + 1}: asking ${carrier.ifEmpty { "the operator" }} with $code")
                try {
                    @Suppress("MissingPermission")
                    tm1.sendUssdRequest(code, object : TelephonyManager.UssdResponseCallback() {
                        override fun onReceiveUssdResponse(t: TelephonyManager, request: String, response: CharSequence) {
                            val text = response.toString()
                            got(PhoneNumbers.inText(text).firstOrNull(), "the answer had no number: " + text.replace(Regex("\\s+"), " ").take(60))
                        }
                        override fun onReceiveUssdResponseFailed(t: TelephonyManager, request: String, failureCode: Int) {
                            got(null, "failure code $failureCode")
                        }
                    }, main)
                    main.postDelayed({ got(null, "no answer in ${ANSWER_MS / 1000} seconds") }, ANSWER_MS)
                } catch (e: Exception) {
                    got(null, "could not send: " + e.javaClass.simpleName)
                }
            }
            tryCode(0)
        }
        next()
    }

    /** "01712345678" -> "017•••••678": enough to recognise, not enough to copy out of a log. */
    fun hide(n: String): String = if (n.length < 7) n else n.take(3) + "•".repeat(n.length - 6) + n.takeLast(3)
}

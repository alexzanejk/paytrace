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

/** The operator's own "what is my number" USSD code, chosen from the carrier name Android reports for a SIM. These codes are
 *  from general knowledge (GP *2#, Robi *140*2*4#, Airtel *121*7*3#, Banglalink *511#, Teletalk *551#) and have not been tried
 *  on the owner's phones; a code that answers with anything but a number simply finds nothing. Unknown carrier = no code,
 *  so PayTrace never dials a guess into a SIM it cannot name. */
object OwnNumberCodes {
    fun codeFor(carrier: String?): String? {
        val c = carrier?.lowercase()?.trim() ?: return null
        return when {
            c.contains("grameen") || c == "gp" || c.startsWith("gp ") -> "*2#"
            c.contains("robi") -> "*140*2*4#"
            c.contains("airtel") -> "*121*7*3#"
            c.contains("banglalink") || c == "bl" -> "*511#"
            c.contains("teletalk") -> "*551#"
            else -> null
        }
    }
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
    private const val ANSWER_MS = 25_000L
    private val main = Handler(Looper.getMainLooper())
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
            val code = OwnNumberCodes.codeFor(carrier)
            if (code == null) { note("SIM ${info.simSlotIndex + 1}: no known 'my number' code for ${carrier.ifEmpty { "this operator" }}"); next(); return }
            val finished = AtomicBoolean(false)
            fun got(number: String?, why: String) {
                if (!finished.compareAndSet(false, true)) return
                val i = seen.indexOfFirst { it.slot == info.simSlotIndex }
                if (i >= 0) seen[i] = seen[i].copy(number = number)
                note("SIM ${info.simSlotIndex + 1}: " + (number?.let { "the operator says " + hide(it) } ?: why))
                if (number == want) done(SimFind.Found(info.simSlotIndex, carrier)) else next()
            }
            note("SIM ${info.simSlotIndex + 1}: asking ${carrier} with $code")
            try {
                @Suppress("MissingPermission")
                tm.createForSubscriptionId(info.subscriptionId).sendUssdRequest(code, object : TelephonyManager.UssdResponseCallback() {
                    override fun onReceiveUssdResponse(t: TelephonyManager, request: String, response: CharSequence) {
                        got(PhoneNumbers.inText(response.toString()).firstOrNull(), "the answer had no number")
                    }
                    override fun onReceiveUssdResponseFailed(t: TelephonyManager, request: String, failureCode: Int) {
                        got(null, "the phone reported failure code $failureCode")
                    }
                }, main)
                main.postDelayed({ got(null, "no answer in ${ANSWER_MS / 1000} seconds") }, ANSWER_MS)
            } catch (e: Exception) {
                got(null, "could not send: " + e.javaClass.simpleName)
            }
        }
        next()
    }

    /** "01712345678" -> "017•••••678": enough to recognise, not enough to copy out of a log. */
    fun hide(n: String): String = if (n.length < 7) n else n.take(3) + "•".repeat(n.length - 6) + n.takeLast(3)
}

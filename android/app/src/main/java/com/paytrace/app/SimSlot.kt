package com.paytrace.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.telephony.SubscriptionManager

/** Which SIM an SMS arrived on: 0 = SIM 1, 1 = SIM 2, null = the phone did not say.
 *
 *  WHY: a phone can hold two wallets of the same kind (an agent bKash on SIM 1 and a personal bKash on SIM 2, as on the
 *  owner's Redmi). Both send their messages under the sender ID "bKash" and the text never names the account, so the SIM
 *  is the only thing that tells them apart. The server keeps one balance chain per phone, wallet type AND SIM, so the two
 *  accounts stop being judged against each other, and since migration 064 a wallet kind the app has in one SIM makes the
 *  other SIM's account "not ours". An old app build sends nothing and the server treats that as "unknown".
 *
 *  Phones name the SIM on the broadcast in different ways (owner 2026-11-08: the Xiaomi 22101316I gave none of the names
 *  the first version knew, while Google Messages on the same phone showed "1: Grameenphone"). So: more names, and when
 *  none is there, the message's own row in the phone's inbox, which the SMS app writes with the subscription a second or
 *  two after the broadcast. The names a phone's broadcast carried when nothing was understood are kept (names only, never
 *  values) and reported in the heartbeat, so the next unknown model is a one-line fix instead of a guess.
 */
object SimSlot {
    /** Keys whose value IS the slot (0 or 1). */
    private val SLOT_KEYS = listOf("slot", "simSlot", "slotId", "slot_id", "simId", "sim_id", "simSlotIndex", "android.telephony.extra.SLOT_INDEX")
    /** Keys whose value is a subscription id, which [slotOfSubscription] turns into a slot. */
    private val SUB_KEYS = listOf(EXTRA_SUBSCRIPTION_INDEX, "subscription", "subscription_id", "sub_id", "subId", "subscriptionId")

    /** Reads the slot from the extras Android (and some brands) put on an incoming-SMS broadcast. Pure, unit tested:
     *  a key that names the slot itself wins, then a subscription id translated by [slotOfSubscription], then the
     *  "phone" id, which on every phone seen so far equals the slot. Anything outside 0..1 is ignored. */
    fun resolve(extras: Map<String, Any?>, slotOfSubscription: (Int) -> Int?): Int? {
        for (k in SLOT_KEYS) {
            val v = asInt(extras[k]) ?: continue
            if (v in 0..1) return v
        }
        subscriptionOf(extras)?.let { sub ->
            val slot = slotOfSubscription(sub)
            if (slot != null && slot in 0..1) return slot
        }
        asInt(extras["phone"])?.let { if (it in 0..1) return it }
        return null
    }

    /** The subscription id on a broadcast, if any (what the SMS provider stores as sub_id). Pure. */
    fun subscriptionOf(extras: Map<String, Any?>): Int? {
        for (k in SUB_KEYS) {
            val sub = asInt(extras[k]) ?: continue
            if (sub >= 0) return sub
        }
        return null
    }

    /** The SIM slot of an incoming SMS broadcast, or null. Never throws. When nothing is understood, the names on the
     *  broadcast are remembered for the heartbeat (see [keysSeen]). */
    fun fromIntent(ctx: Context, intent: Intent): Int? = try {
        val map = extrasOf(intent)
        val slot = resolve(map) { sub -> slotOf(ctx, sub) }
        if (slot == null) rememberKeys(ctx, map.keys)
        slot
    } catch (e: Exception) {
        null
    }

    /** The subscription id of an incoming SMS broadcast, or null. Never throws. */
    fun subscriptionFromIntent(intent: Intent): Int? = try {
        subscriptionOf(extrasOf(intent))
    } catch (e: Exception) {
        null
    }

    private fun extrasOf(intent: Intent): Map<String, Any?> {
        val b = intent.extras
        val map = HashMap<String, Any?>()
        if (b != null) for (k in b.keySet()) map[k] = @Suppress("DEPRECATION") b.get(k)
        return map
    }

    /** The slot a subscription id lives in (the inbox stores the subscription id, not the slot). Null when Android
     *  cannot say: on Android 10+ it needs no permission; before that it needs READ_PHONE_STATE, which the phone may not
     *  have granted, and then the message simply travels without a SIM. */
    fun slotOf(ctx: Context, subId: Int?): Int? {
        if (subId == null || subId < 0) return null
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val s = SubscriptionManager.getSlotIndex(subId)
                return if (s in 0..1) s else null
            }
            val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager ?: return null
            @Suppress("MissingPermission")
            val s = sm.getActiveSubscriptionInfo(subId)?.simSlotIndex ?: return null
            return if (s in 0..1) s else null
        } catch (e: Exception) {
            return null
        }
    }

    /** The slot of a message as the phone's own inbox recorded it: the newest row from this sender with this exact text,
     *  not older than [sinceMs]. The SMS app writes that row (with the subscription) within a second or two of the
     *  broadcast, so the caller tries more than once. Null when there is no such row yet, no column, or no permission.
     *  Reads only the subscription column of one row; never the message text. */
    fun fromProvider(ctx: Context, sender: String, body: String, sinceMs: Long): Int? = try {
        var out: Int? = null
        ctx.contentResolver.query(
            Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms.SUBSCRIPTION_ID),
            "${Telephony.Sms.ADDRESS} = ? AND ${Telephony.Sms.BODY} = ? AND ${Telephony.Sms.DATE} >= ?",
            arrayOf(sender, body, sinceMs.toString()), "${Telephony.Sms.DATE} DESC",
        )?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) out = slotOf(ctx, c.getInt(0))
        }
        out
    } catch (e: Exception) {
        null
    }

    /** [fromProvider], tried a few times while the SMS app writes the row (0, 0.8 and 2 seconds). */
    fun fromProviderPatiently(ctx: Context, sender: String, body: String, sinceMs: Long): Int? {
        for (wait in longArrayOf(0L, 800L, 1200L)) {
            if (wait > 0) try { Thread.sleep(wait) } catch (e: InterruptedException) { return null }
            fromProvider(ctx, sender, body, sinceMs)?.let { return it }
        }
        return null
    }

    const val EXTRA_SUBSCRIPTION_INDEX = "android.telephony.extra.SUBSCRIPTION_INDEX"

    private const val PREFS = "paytrace_sim"
    private const val KEY_SEEN = "keys_seen"

    /** The extra names (never values) of the last broadcast whose SIM could not be read, for the heartbeat. */
    fun keysSeen(ctx: Context): String = try {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_SEEN, "") ?: ""
    } catch (e: Exception) {
        ""
    }

    private fun rememberKeys(ctx: Context, keys: Collection<String>) {
        try {
            val text = keys.filter { it.isNotBlank() }.sorted().joinToString(",").take(200)
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_SEEN, text).apply()
        } catch (e: Exception) {
        }
    }

    private fun asInt(v: Any?): Int? = when (v) {
        is Int -> v
        is Long -> if (v in Int.MIN_VALUE..Int.MAX_VALUE) v.toInt() else null
        is Short -> v.toInt()
        is String -> v.trim().toIntOrNull()
        else -> null
    }
}

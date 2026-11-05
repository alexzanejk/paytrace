package com.paytrace.app

import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SubscriptionManager

/** Which SIM an SMS arrived on: 0 = SIM 1, 1 = SIM 2, null = the phone did not say.
 *
 *  WHY: a phone can hold two wallets of the same kind (an agent bKash on SIM 1 and a personal bKash on SIM 2, as on the
 *  owner's Redmi). Both send their messages under the sender ID "bKash" and the text never names the account, so the SIM
 *  is the only thing that tells them apart. The server keeps one balance chain per phone, wallet type AND SIM, so the two
 *  accounts stop being judged against each other. An old app build sends nothing and the server treats that as "unknown".
 */
object SimSlot {
    /** Reads the slot from the extras Android (and some brands) put on an incoming-SMS broadcast. Pure, unit tested:
     *  a key that names the slot itself wins, then a subscription id translated by [slotOfSubscription], then the
     *  "phone" id, which on every phone seen so far equals the slot. Anything outside 0..1 is ignored. */
    fun resolve(extras: Map<String, Any?>, slotOfSubscription: (Int) -> Int?): Int? {
        for (k in listOf("slot", "simSlot", "slotId")) {
            val v = asInt(extras[k]) ?: continue
            if (v in 0..1) return v
        }
        for (k in listOf(EXTRA_SUBSCRIPTION_INDEX, "subscription", "subscription_id", "sub_id")) {
            val sub = asInt(extras[k]) ?: continue
            if (sub < 0) continue
            val slot = slotOfSubscription(sub) ?: continue
            if (slot in 0..1) return slot
        }
        asInt(extras["phone"])?.let { if (it in 0..1) return it }
        return null
    }

    /** The SIM slot of an incoming SMS broadcast, or null. Never throws. */
    fun fromIntent(ctx: Context, intent: Intent): Int? = try {
        val b = intent.extras
        val map = HashMap<String, Any?>()
        if (b != null) for (k in b.keySet()) map[k] = @Suppress("DEPRECATION") b.get(k)
        resolve(map) { sub -> slotOf(ctx, sub) }
    } catch (e: Exception) {
        null
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

    const val EXTRA_SUBSCRIPTION_INDEX = "android.telephony.extra.SUBSCRIPTION_INDEX"

    private fun asInt(v: Any?): Int? = when (v) {
        is Int -> v
        is Long -> if (v in Int.MIN_VALUE..Int.MAX_VALUE) v.toInt() else null
        is Short -> v.toInt()
        is String -> v.trim().toIntOrNull()
        else -> null
    }
}

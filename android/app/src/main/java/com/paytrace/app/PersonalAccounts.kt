package com.paytrace.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One personal account as the heartbeat reports it. [inApp] = it is the one signed in to the wallet's personal app. */
/** [n] = which personal account of that wallet it is on this phone (1 or 2); the dashboard names it in a command. */
data class PersonalEntry(val provider: String, val number: String, val slot: Int, val inApp: Boolean = false, val n: Int = 1)

/** Personal accounts (owner 2026-11-08): a phone may hold personal bKash or Nagad accounts beside its agent one. The app
 *  shows their setup only while the owner has switched "Personal accounts on this phone" on in the dashboard (it arrives
 *  as `allow.personal` on the heartbeat reply, [RemoteSwitches]). Since 2026-11-16 there can be TWO personal accounts of one
 *  wallet, one per SIM. Every account of one wallet (agent or personal) must be in its own SIM, because the SIM is the only
 *  thing on an SMS that tells them apart. A personal bKash account can send payouts by Send Money ([SendMoneyFlow], from its
 *  own SIM and PIN): personal account 1 does that. Personal Nagad sending is not built yet. */
object PersonalAccounts {
    /** Wallets that can have a personal account here. */
    val providers = listOf(UssdProviders.BKASH, UssdProviders.NAGAD)

    /** Personal accounts per wallet on one phone (one per SIM). */
    val slots = listOf(1, 2)

    /** True when [slot] is already held by another account of the same wallet. An account with no number saved claims no SIM. */
    fun clash(otherNumber: String, otherSlot: Int, slot: Int): Boolean = otherNumber.isNotEmpty() && otherSlot == slot

    /** True when [slot] is held by any of [others] (number, slot). */
    fun taken(others: List<Pair<String, Int>>, slot: Int): Boolean = others.any { (number, s) -> clash(number, s, slot) }

    /** The heartbeat's `wallets` list: every agent account with a number, and, while personal accounts are allowed, every
     *  personal one with a number and a SIM. Each says which kind it is, so the server files its SMS under the right one;
     *  the personal account signed in to the personal app also says `app: true`. */
    fun walletsJson(
        agents: List<Triple<String, String, Pair<Int, Boolean>>>,
        personal: List<PersonalEntry>,
        personalAllowed: Boolean,
    ): JSONArray {
        val a = JSONArray()
        for ((prov, number, slotFound) in agents) {
            if (number.isEmpty()) continue
            a.put(JSONObject().put("provider", prov).put("number", number).put("slot", slotFound.first).put("found", slotFound.second).put("kind", "agent"))
        }
        if (personalAllowed) {
            for (e in personal) {
                if (e.number.isEmpty() || e.slot !in 0..1) continue
                val o = JSONObject().put("provider", e.provider).put("number", e.number).put("slot", e.slot).put("found", false).put("kind", "personal").put("n", e.n)
                if (e.inApp) o.put("app", true)
                a.put(o)
            }
        }
        return a
    }

    fun pinStore(ctx: Context, provider: String, n: Int = 1): SecretStore =
        SecretStore(ctx.applicationContext, if (n == 2) "ussd_pin_personal2_$provider" else "ussd_pin_personal_$provider")
    fun pinSaved(ctx: Context, provider: String, n: Int = 1): Boolean = pinStore(ctx, provider, n).get().isNotEmpty()

    /** Every personal account the phone holds, for the heartbeat. */
    fun entries(s: AppSettings): List<PersonalEntry> = providers.flatMap { prov ->
        slots.map { n -> PersonalEntry(prov, s.personalNumberOf(prov, n), s.personalSlotOf(prov, n), s.personalAppOf(prov) == n, n) }
    }

    /** The account a dashboard command names: 2 only when it says exactly 2; anything else is account 1 (the old way). */
    fun accountOf(v: Int): Int = if (v == 2) 2 else 1
}

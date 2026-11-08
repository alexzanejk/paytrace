package com.paytrace.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Personal accounts (owner 2026-11-08): a phone may hold a personal bKash or Nagad account beside its agent one. The app
 *  shows their setup only while the owner has switched "Personal accounts on this phone" on in the dashboard (it arrives
 *  as `allow.personal` on the heartbeat reply, [RemoteSwitches]). An agent and a personal account of the same kind must be
 *  in different SIMs, because the SIM is the only thing on an SMS that tells the two apart. A personal bKash account can
 *  send payouts by Send Money ([SendMoneyFlow], from its own SIM and PIN); personal Nagad is not built yet. */
object PersonalAccounts {
    /** Wallets that can have a personal account here. */
    val providers = listOf(UssdProviders.BKASH, UssdProviders.NAGAD)

    /** True when [slot] would put the personal and the agent account of one kind in the same SIM. An agent account with no
     *  number saved claims no SIM. */
    fun clash(agentNumber: String, agentSlot: Int, slot: Int): Boolean = agentNumber.isNotEmpty() && agentSlot == slot

    /** The heartbeat's `wallets` list: every agent account with a number, and, while personal accounts are allowed, every
     *  personal one with a number and a SIM. Each says which kind it is, so the server files its SMS under the right one. */
    fun walletsJson(
        agents: List<Triple<String, String, Pair<Int, Boolean>>>,
        personal: List<Triple<String, String, Int>>,
        personalAllowed: Boolean,
    ): JSONArray {
        val a = JSONArray()
        for ((prov, number, slotFound) in agents) {
            if (number.isEmpty()) continue
            a.put(JSONObject().put("provider", prov).put("number", number).put("slot", slotFound.first).put("found", slotFound.second).put("kind", "agent"))
        }
        if (personalAllowed) {
            for ((prov, number, slot) in personal) {
                if (number.isEmpty() || slot !in 0..1) continue
                a.put(JSONObject().put("provider", prov).put("number", number).put("slot", slot).put("found", false).put("kind", "personal"))
            }
        }
        return a
    }

    fun pinStore(ctx: Context, provider: String): SecretStore = SecretStore(ctx.applicationContext, "ussd_pin_personal_$provider")
    fun pinSaved(ctx: Context, provider: String): Boolean = pinStore(ctx, provider).get().isNotEmpty()
}

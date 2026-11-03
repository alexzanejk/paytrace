package com.paytrace.app

import android.content.Context
import org.json.JSONObject

/** The two switches the OWNER controls from the dashboard (owner 2026-11-03: they must not be changeable on the phone):
 *  may the dashboard check a balance or read a statement, and may it make this phone send money. They arrive on every
 *  heartbeat reply as `"allow":{"balance":true,"cashin":false}` and are stored in [AppSettings.ussdAllowed] and
 *  [AppSettings.cashInAllowed], which the commands already check. A reply without them (an old server, a lookup failure,
 *  a shared-secret setup) changes nothing. Nothing on the phone's own screen can change them any more. */
data class Switches(val balance: Boolean, val cashIn: Boolean)

object RemoteSwitches {
    /** Reads the `allow` object. Anything that is not a plain true or false for BOTH values means "no change". */
    fun parse(body: String?): Switches? {
        if (body.isNullOrBlank()) return null
        return try {
            val a = JSONObject(body).optJSONObject("allow") ?: return null
            val b = a.opt("balance")
            val c = a.opt("cashin")
            if (b is Boolean && c is Boolean) Switches(b, c) else null
        } catch (e: Exception) {
            null
        }
    }

    fun apply(ctx: Context, body: String?) {
        val sw = parse(body) ?: return
        val s = AppSettings(ctx)
        if (s.ussdAllowed != sw.balance) s.ussdAllowed = sw.balance
        if (s.cashInAllowed != sw.cashIn) s.cashInAllowed = sw.cashIn
    }
}

package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat

/** One SIM in the phone: its slot (0 = SIM 1, 1 = SIM 2) and the carrier name Android shows for it, if known. */
data class SimName(val slot: Int, val carrier: String)

/** Names the SIMs the way a partner sees them ("SIM 1 · Grameenphone"), so choosing one is not a guess. Reading the names
 *  needs the phone-state permission the balance check already asks for; without it, or if Android refuses, the plain
 *  "SIM 1" / "SIM 2" are shown and everything still works. */
object SimNames {
    /** Pure, tested: the words for one slot. */
    fun label(slot: Int, sims: List<SimName>): String {
        val n = slot.coerceIn(0, 1) + 1
        val carrier = sims.firstOrNull { it.slot == slot }?.carrier?.trim().orEmpty()
        return if (carrier.isEmpty()) "SIM $n" else "SIM $n · $carrier"
    }

    fun list(ctx: Context): List<SimName> {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return emptyList()
        return try {
            val sm = ctx.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            @Suppress("MissingPermission")
            (sm.activeSubscriptionInfoList ?: emptyList()).map { SimName(it.simSlotIndex, it.carrierName?.toString().orEmpty()) }
        } catch (e: Exception) {
            emptyList()
        }
    }
}

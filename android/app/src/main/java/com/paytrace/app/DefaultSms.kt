package com.paytrace.app

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.provider.Telephony

/** Optional "SMS app mode": PayTrace becomes the phone's default messaging app. Android then hands it every message
 *  first and phone brands almost never stop the messaging app, so payment messages keep arriving even when the
 *  screen is off. The price: the phone's other messaging apps stop receiving new messages themselves; PayTrace
 *  writes every message into the phone's inbox so they still show up there. */
object DefaultSms {
    fun isDefault(ctx: Context): Boolean = try {
        Telephony.Sms.getDefaultSmsPackage(ctx) == ctx.packageName
    } catch (e: Exception) {
        false
    }

    /** The system screen that asks "make PayTrace your SMS app?". Null if this phone cannot show it. */
    fun requestIntent(ctx: Context): Intent? = try {
        if (Build.VERSION.SDK_INT >= 29) {
            val rm = ctx.getSystemService(RoleManager::class.java)
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_SMS) && !rm.isRoleHeld(RoleManager.ROLE_SMS)) {
                rm.createRequestRoleIntent(RoleManager.ROLE_SMS)
            } else {
                null
            }
        } else {
            Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT).putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, ctx.packageName)
        }
    } catch (e: Exception) {
        null
    }

    /** Where the owner goes to hand SMS duties back to another app (the phone's own Default apps page). */
    fun settingsIntent(): Intent = Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
}

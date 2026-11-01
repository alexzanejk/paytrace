package com.paytrace.app

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.content.ContextCompat

/** The list Android keeps of the accessibility services that are switched on: component names separated by colons.
 *  Pure, so it is unit tested: other apps' services must never be lost, and ours must never be listed twice. */
object AccessibilityList {
    fun has(current: String?, component: String): Boolean =
        parts(current).any { it.equals(component, ignoreCase = true) }

    fun withService(current: String?, component: String): String {
        val list = parts(current)
        if (list.any { it.equals(component, ignoreCase = true) }) return list.joinToString(":")
        return (list + component).joinToString(":")
    }

    private fun parts(current: String?): List<String> =
        (current ?: "").split(':').map { it.trim() }.filter { it.isNotEmpty() }
}

/** Android switches PayTrace OFF in Accessibility settings every time the app is updated, because the app was installed from a
 *  file rather than a store ("restricted setting"). On a phone where the balance check is done through the dialer that means the
 *  check stops working after each update until someone notices.
 *
 *  If the owner has given this phone WRITE_SECURE_SETTINGS once, over a cable or wireless debugging
 *  ("adb shell pm grant com.paytrace.app android.permission.WRITE_SECURE_SETTINGS"), PayTrace puts itself back into that list by
 *  itself. Without the permission nothing happens at all, and the owner switches it on by hand as before. This is the only use
 *  of that permission: PayTrace's own balance-check service, and no other setting is ever written. */
object AccessibilityHeal {
    fun allowed(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED

    /** True only when this call actually switched the service back on (so the caller can give Android a moment to start it). */
    fun heal(ctx: Context): Boolean {
        val app = ctx.applicationContext
        if (UssdSetup.accessibilityOn(app)) return false
        if (!allowed(app)) return false
        return try {
            val me = ComponentName(app, UssdAccessibilityService::class.java).flattenToString()
            val cr = app.contentResolver
            val now = Settings.Secure.getString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            if (AccessibilityList.has(now, me)) return false
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES, AccessibilityList.withService(now, me))
            Settings.Secure.putInt(cr, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
            true
        } catch (e: Exception) {
            // No permission after all, or the phone refuses: the owner switches it on by hand.
            false
        }
    }
}

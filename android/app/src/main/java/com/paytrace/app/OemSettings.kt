package com.paytrace.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent

/** Opens the phone brand's own hidden "autostart / background" page, which a normal settings link cannot reach.
 *  These are the vendor screens' real names; a phone model that does not have one just skips to the next. */
object OemSettings {
    data class Target(val pkg: String, val cls: String)

    /** Pure and in order of preference, so it can be unit tested. Empty for a phone with no such page of its own. */
    fun candidates(manufacturer: String?): List<Target> {
        val m = (manufacturer ?: "").trim().lowercase()
        return when {
            m.contains("vivo") || m.contains("iqoo") -> listOf(
                Target("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                Target("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
                Target("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity"),
            )
            m.contains("oneplus") -> listOf(
                Target("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
                Target("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                Target("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
            )
            m.contains("oppo") || m.contains("realme") -> listOf(
                Target("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                Target("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                Target("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
            )
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> listOf(
                Target("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            )
            m.contains("huawei") || m.contains("honor") -> listOf(
                Target("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                Target("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"),
            )
            m.contains("samsung") -> listOf(
                Target("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            )
            // Tecno, Infinix and itel (Transsion): HiOS / XOS / itel OS have their own phone-manager apps.
            m.contains("tecno") || m.contains("infinix") || m.contains("itel") || m.contains("transsion") -> listOf(
                Target("com.transsion.phonemaster", "com.transsion.phonemaster.business.autostart.ui.AutoStartListActivity"),
                Target("com.transsion.powermanager", "com.transsion.powermanager.activity.AutoStartActivity"),
                Target("com.hios.security", "com.hios.security.autostart.AutoStartActivity"),
            )
            m.contains("asus") -> listOf(
                Target("com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity"),
            )
            else -> emptyList()
        }
    }

    /** Tries each page in turn. true = one opened. false = none did (the caller then opens the app's normal settings page). */
    fun open(ctx: Context, manufacturer: String? = android.os.Build.MANUFACTURER): Boolean {
        for (t in candidates(manufacturer)) {
            try {
                ctx.startActivity(Intent().setComponent(ComponentName(t.pkg, t.cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (e: Exception) {
                // Not on this model, or not allowed to open: try the next one.
            }
        }
        return false
    }
}

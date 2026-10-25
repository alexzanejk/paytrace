package com.paytrace.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings

/** Where the "Open" button on a settings step can take the owner. Every step has several [Way]s, best first, and the last ones always
 *  work on every phone (PayTrace's own app-info page, then the phone's Settings home). The owner sees which page opened and can move to
 *  the next one with a tap, so a hidden vendor page that opens the wrong screen (or nothing) is never a dead end. */
data class Way(
    val id: String,
    /** Plain words shown after it opens: "Opened: <label>". */
    val label: String,
    /** A vendor page (package + class), or null when [action] is used. */
    val pkg: String? = null,
    val cls: String? = null,
    val action: String? = null,
    /** Add "package:<this app>" as the intent data (the system pages that are about one app). */
    val aboutThisApp: Boolean = false,
    /** Extra values for vendor pages that take the app's name: {pkg} and {label} are filled in. */
    val extras: Map<String, String> = emptyMap(),
)

object SettingsWays {
    // ---- pages every phone has ----
    val APP_INFO = Way("app_info", "PayTrace's own app page (open Battery or Permissions from here)", action = AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, aboutThisApp = true)
    val SETTINGS_HOME = Way("settings_home", "the phone's Settings home (search for the setting's name)", action = AndroidSettings.ACTION_SETTINGS)
    val BATTERY_DIALOG = Way("batt_dialog", "the \"allow PayTrace to run in the background\" question", action = AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, aboutThisApp = true)
    val BATTERY_LIST = Way("batt_list", "the battery optimisation list (choose \"All apps\", then PayTrace)", action = AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    val BATTERY_SAVER = Way("batt_saver", "the battery saver page", action = AndroidSettings.ACTION_BATTERY_SAVER_SETTINGS)
    val POWER_USAGE = Way("power_usage", "the battery usage page", action = Intent.ACTION_POWER_USAGE_SUMMARY)

    private fun vendor(id: String, label: String, pkg: String, cls: String, extras: Map<String, String> = emptyMap()) =
        Way(id, label, pkg = pkg, cls = cls, extras = extras)

    // ---- brand pages (the same hidden screens the OemSettings list knows, each with a plain name) ----
    private val VIVO_BG_LIST = vendor("vivo_wl", "Vivo: apps allowed high background power use", "com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
    private val VIVO_AUTOSTART = vendor("vivo_auto", "Vivo: background startup manager", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
    private val VIVO_PERMS = vendor("vivo_perm", "Vivo: permission manager", "com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity")
    private val ONEPLUS_CHAIN = vendor("op_chain", "OnePlus: auto-launch list", "com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
    private val COLOROS_STARTUP = vendor("color_start", "ColorOS: startup apps list", "com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
    private val COLOROS_STARTUP2 = vendor("color_start2", "ColorOS: startup apps list", "com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")
    private val OPPO_STARTUP = vendor("oppo_start", "Oppo: startup apps list", "com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")
    private val OPLUS_POWER = vendor("oplus_power", "ColorOS: power usage settings", "com.coloros.oppoguardelf", "com.coloros.powermanager.fuelgauge.PowerUsageModelActivity")
    private val MIUI_AUTOSTART = vendor("miui_auto", "Xiaomi: Autostart manager", "com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
    private val MIUI_SAVER = vendor(
        "miui_saver", "Xiaomi: PayTrace's battery saver choice", "com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity",
        extras = mapOf("package_name" to "{pkg}", "package_label" to "{label}"),
    )
    private val SAMSUNG_BATTERY = vendor("sam_batt", "Samsung: Device care battery page", "com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity")
    private val SAMSUNG_BATTERY_CN = vendor("sam_batt2", "Samsung: Device care battery page", "com.samsung.android.sm_cn", "com.samsung.android.sm.ui.battery.BatteryActivity")
    private val HUAWEI_STARTUP = vendor("hw_start", "Huawei: startup manager", "com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
    private val HUAWEI_PROTECT = vendor("hw_protect", "Huawei: protected apps", "com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")
    private val HUAWEI_POWER = vendor("hw_power", "Huawei: power manager", "com.huawei.systemmanager", "com.huawei.systemmanager.power.ui.HwPowerManagerActivity")
    private val TR_PHONEMASTER = vendor("tr_pm", "Phone Master: autostart manager", "com.transsion.phonemaster", "com.transsion.phonemaster.business.autostart.ui.AutoStartListActivity")
    private val TR_POWER = vendor("tr_power", "Transsion: autostart manager", "com.transsion.powermanager", "com.transsion.powermanager.activity.AutoStartActivity")
    private val TR_HIOS = vendor("tr_hios", "HiOS: autostart manager", "com.hios.security", "com.hios.security.autostart.AutoStartActivity")
    private val ASUS_AUTOSTART = vendor("asus_auto", "Asus: autostart manager", "com.asus.mobilemanager", "com.asus.mobilemanager.autostart.AutoStartActivity")

    private fun maker(m: String?) = (m ?: "").trim().lowercase()
    private fun isVivo(m: String) = m.contains("vivo") || m.contains("iqoo")
    private fun isOppoFamily(m: String) = m.contains("oneplus") || m.contains("oppo") || m.contains("realme")
    private fun isXiaomi(m: String) = m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")
    private fun isHuawei(m: String) = m.contains("huawei") || m.contains("honor")
    private fun isTranssion(m: String) = m.contains("tecno") || m.contains("infinix") || m.contains("itel") || m.contains("transsion")

    /** The pages to try for one step of the guide, best first. Never empty, and always ends with [APP_INFO] then [SETTINGS_HOME]. Pure, so it is unit tested. */
    fun forStep(stepId: String, manufacturer: String?): List<Way> {
        val m = maker(manufacturer)
        val first: List<Way> = when (stepId) {
            "vivo_bg" -> listOf(VIVO_BG_LIST, BATTERY_SAVER)
            "vivo_autostart" -> listOf(VIVO_AUTOSTART, VIVO_PERMS)
            "vivo_saver" -> listOf(BATTERY_SAVER, POWER_USAGE)
            "op_battery", "tr_batt", "gen_batt" -> listOf(BATTERY_DIALOG, BATTERY_LIST)
            "op_bg" -> listOf(ONEPLUS_CHAIN, COLOROS_STARTUP, COLOROS_STARTUP2)
            "op_sleep" -> listOf(OPLUS_POWER, BATTERY_SAVER, POWER_USAGE)
            "xi_autostart" -> listOf(MIUI_AUTOSTART)
            "xi_saver" -> listOf(MIUI_SAVER, BATTERY_SAVER)
            "sa_never", "sa_unused" -> listOf(SAMSUNG_BATTERY, SAMSUNG_BATTERY_CN, BATTERY_SAVER)
            "tr_auto" -> listOf(TR_PHONEMASTER, TR_POWER, TR_HIOS)
            "tr_power" -> listOf(TR_PHONEMASTER)
            "hu_launch" -> listOf(HUAWEI_STARTUP, HUAWEI_PROTECT, HUAWEI_POWER)
            "gen_auto" -> OemSettings.candidates(manufacturer).map { vendor("oem_" + it.cls.substringAfterLast('.'), "the phone brand's autostart page", it.pkg, it.cls) }
            else -> emptyList()
        }
        // The app's own page is the best first stop for steps that live inside it (OnePlus background activity, Xiaomi saver on phones without the direct page).
        val appFirst = stepId == "op_bg" && isOppoFamily(m)
        val ordered = if (appFirst) listOf(APP_INFO) + first else first
        val tail = if (appFirst) listOf(SETTINGS_HOME) else listOf(APP_INFO, SETTINGS_HOME)
        return (ordered + tail).distinctBy { it.id }
    }
}

/** Starts a [Way]. Kept apart from the list so the list can be tested without a phone. */
object SettingsOpener {
    fun intentFor(ctx: Context, w: Way): Intent {
        val i = if (w.pkg != null && w.cls != null) Intent().setComponent(ComponentName(w.pkg, w.cls)) else Intent(w.action)
        if (w.aboutThisApp) i.data = Uri.parse("package:" + ctx.packageName)
        for ((k, v) in w.extras) i.putExtra(k, v.replace("{pkg}", ctx.packageName).replace("{label}", "PayTrace"))
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    /** True if the phone accepted the request to open it. (A vendor page that opens nothing visible still counts, which is why the
     *  screen always offers "try another page".) */
    fun start(ctx: Context, w: Way): Boolean = try {
        ctx.startActivity(intentFor(ctx, w))
        true
    } catch (e: Exception) {
        false
    }

    /** Opens the first page from index [from] that the phone accepts. Returns its index, or null when none opened. */
    fun openFrom(ctx: Context, ways: List<Way>, from: Int): Int? {
        for (i in from.coerceAtLeast(0) until ways.size) if (start(ctx, ways[i])) return i
        return null
    }
}

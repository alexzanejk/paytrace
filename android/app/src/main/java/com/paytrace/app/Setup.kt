package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Everything the phone must allow for PayTrace to run without interruption. The app stays on the setup screen
 *  until none of these is missing, and the service tells the owner (in its notification) if one is taken away later. */
object Setup {
    enum class Req { SMS_RECEIVE, SMS_READ, NOTIFICATIONS, BATTERY, AUTOSTART }

    data class State(
        val smsReceive: Boolean,
        val smsRead: Boolean,
        val notifications: Boolean,
        val batteryExempt: Boolean,
        val autostartNeeded: Boolean,
        val autostartConfirmed: Boolean,
    )

    /** What is still missing, in the order the setup screen shows it. Pure, so it is unit tested. */
    fun missing(s: State): List<Req> = buildList {
        if (!s.smsReceive) add(Req.SMS_RECEIVE)
        if (!s.smsRead) add(Req.SMS_READ)
        if (!s.notifications) add(Req.NOTIFICATIONS)
        if (!s.batteryExempt) add(Req.BATTERY)
        if (s.autostartNeeded && !s.autostartConfirmed) add(Req.AUTOSTART)
    }

    /** Phone makers whose own power manager (not stock Android) also stops background apps. Android cannot tell an app
     *  whether the owner changed that setting, so for these the owner confirms it by hand. */
    private val STRICT_MAKERS = listOf(
        "vivo", "iqoo", "oppo", "realme", "oneplus", "xiaomi", "redmi", "poco", "huawei", "honor",
        "samsung", "tecno", "infinix", "itel", "asus", "meizu", "lenovo", "motorola",
    )

    fun needsAutostartConfirm(manufacturer: String?): Boolean {
        val m = (manufacturer ?: "").trim().lowercase()
        return m.isNotEmpty() && STRICT_MAKERS.any { m.contains(it) }
    }

    /** What to switch on in this phone brand's own battery manager, which Android's standard "no battery limit" setting
     *  does not cover. Wording differs a little between models, so the steps name the screens to look for. */
    fun brandSteps(manufacturer: String?): List<String> {
        val m = (manufacturer ?: "").trim().lowercase()
        val lockStep = "Open the recent-apps screen and LOCK PayTrace (pull its card down, or tap the small lock icon), so cleaning never closes it."
        return when {
            m.contains("vivo") || m.contains("iqoo") -> listOf(
                "Settings > Battery > Background power consumption management > PayTrace > choose \"Allow high background power consumption\".",
                "Settings > Apps (or i Manager > App manager) > Autostart: switch PayTrace on.",
                lockStep,
            )
            m.contains("oneplus") || m.contains("oppo") || m.contains("realme") -> listOf(
                "Settings > Battery > Battery optimization > PayTrace > Don't optimize.",
                "Settings > Apps > App management > PayTrace > Battery usage: Allow background activity, and Allow auto-launch.",
                "Settings > Battery > More battery settings: switch OFF \"Sleep standby optimization\" and \"Deep optimization\".",
                lockStep,
            )
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> listOf(
                "Settings > Apps > Manage apps > PayTrace > Autostart: switch on.",
                "Same screen > Battery saver: choose \"No restrictions\".",
                lockStep,
            )
            m.contains("samsung") -> listOf(
                "Settings > Battery > Background usage limits > Never sleeping apps: add PayTrace.",
                "Same screen: switch OFF \"Put unused apps to sleep\".",
                lockStep,
            )
            m.contains("tecno") || m.contains("infinix") || m.contains("itel") || m.contains("transsion") -> listOf(
                "Open the Phone Master app (or Settings > Battery) > Autostart manager (HiOS / XOS): switch PayTrace ON.",
                "Settings > Apps > PayTrace > Battery > choose \"No restrictions\" (or \"Don't optimise\"), and allow background activity.",
                "Phone Master > Battery / Power > App power management: set PayTrace to \"Allow\" or \"Always run\" if the phone lists it.",
                lockStep,
            )
            m.contains("huawei") || m.contains("honor") -> listOf(
                "Settings > Battery > App launch > PayTrace: switch to \"Manage manually\" and turn ON auto-launch, secondary launch and run in background.",
                lockStep,
            )
            else -> listOf(
                "Open PayTrace's page in the phone's Settings > Apps and set battery to \"No restrictions\" / \"Don't optimize\".",
                "Allow auto-start / background activity if the phone has that option.",
                lockStep,
            )
        }
    }

    // ---- the guide: exactly what to change, one step at a time ----

    /** What the "Open" button on a step does. */
    enum class Open { NONE, AUTOSTART_PAGE, BATTERY_SETTINGS, APP_DETAILS }

    /** One setting the owner must change by hand. [path] is where to find it, [choose] is the exact option to pick and
     *  [avoid] the option that looks right but is not (on the Vivo that was "Optimized", which got PayTrace stopped). */
    data class GuideStep(
        val id: String,
        val title: String,
        val path: String,
        val choose: String,
        val avoid: String?,
        val why: String,
        val open: Open,
    )

    private val LOCK = GuideStep(
        "lock", "Lock PayTrace in the recent-apps screen",
        "Open the recent-apps screen (swipe up from the bottom and hold) and find PayTrace",
        "Pull PayTrace's card down, or tap the small lock icon, until a lock shows on the card",
        null, "Phone cleaning skips locked apps, so it cannot close PayTrace.", Open.NONE,
    )

    /** The settings that matter on this phone brand, in the order to do them. Pure, so it is unit tested. */
    fun guide(manufacturer: String?): List<GuideStep> {
        val m = (manufacturer ?: "").trim().lowercase()
        return when {
            m.contains("vivo") || m.contains("iqoo") -> listOf(
                GuideStep(
                    "vivo_bg", "Let PayTrace use battery in the background",
                    "Settings > Battery > Background power consumption management > PayTrace",
                    "Allow high background power consumption",
                    "Optimized (or Smart): with these the phone closes PayTrace when the screen is off",
                    "This is the setting that stopped PayTrace on Vivo phones.", Open.BATTERY_SETTINGS,
                ),
                GuideStep(
                    "vivo_autostart", "Let PayTrace start by itself",
                    "Settings > Apps & permissions > Autostart (or i Manager > App manager > Autostart)",
                    "Switch PayTrace ON", null,
                    "Without it PayTrace cannot start again after the phone stops it.", Open.AUTOSTART_PAGE,
                ),
                GuideStep(
                    "vivo_saver", "Turn off the power-saving modes",
                    "Settings > Battery",
                    "Super power saving and Ultra power saving: OFF", null,
                    "These close every app in the background.", Open.BATTERY_SETTINGS,
                ),
                LOCK,
            )
            m.contains("oneplus") || m.contains("oppo") || m.contains("realme") -> listOf(
                GuideStep(
                    "op_battery", "Do not optimise PayTrace's battery use",
                    "Settings > Battery > Battery optimization > PayTrace",
                    "Don't optimize", "Optimize",
                    "Optimised apps are stopped when the screen is off.", Open.BATTERY_SETTINGS,
                ),
                GuideStep(
                    "op_bg", "Allow background activity and auto-launch",
                    "Settings > Apps > App management > PayTrace > Battery usage",
                    "Allow background activity: ON, and Allow auto-launch: ON", null,
                    "Lets PayTrace keep running and start again on its own.", Open.APP_DETAILS,
                ),
                GuideStep(
                    "op_sleep", "Turn off the sleep optimisations",
                    "Settings > Battery > More battery settings",
                    "Sleep standby optimization: OFF, and Deep optimization: OFF", null,
                    "They freeze apps while the screen is off.", Open.BATTERY_SETTINGS,
                ),
                LOCK,
            )
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> listOf(
                GuideStep(
                    "xi_autostart", "Let PayTrace start by itself",
                    "Settings > Apps > Manage apps > PayTrace > Autostart",
                    "Switch it ON", null,
                    "Without it PayTrace cannot start again after the phone stops it.", Open.AUTOSTART_PAGE,
                ),
                GuideStep(
                    "xi_saver", "Remove the battery restriction",
                    "Settings > Apps > Manage apps > PayTrace > Battery saver",
                    "No restrictions", "Battery saver or Restricted",
                    "Restricted apps are stopped in the background.", Open.APP_DETAILS,
                ),
                LOCK,
            )
            m.contains("samsung") -> listOf(
                GuideStep(
                    "sa_never", "Add PayTrace to the never-sleeping apps",
                    "Settings > Battery > Background usage limits > Never sleeping apps",
                    "Add PayTrace to the list", "PayTrace listed under Sleeping apps or Deep sleeping apps",
                    "Sleeping apps are stopped in the background.", Open.AUTOSTART_PAGE,
                ),
                GuideStep(
                    "sa_unused", "Stop unused apps being put to sleep",
                    "Settings > Battery > Background usage limits",
                    "Put unused apps to sleep: OFF", null,
                    "Otherwise Samsung puts PayTrace to sleep when you do not open it.", Open.BATTERY_SETTINGS,
                ),
                LOCK,
            )
            m.contains("tecno") || m.contains("infinix") || m.contains("itel") || m.contains("transsion") -> listOf(
                GuideStep(
                    "tr_auto", "Let PayTrace start by itself",
                    "Phone Master (or Settings) > Autostart manager",
                    "Switch PayTrace ON", null,
                    "Without it PayTrace cannot start again after the phone stops it.", Open.AUTOSTART_PAGE,
                ),
                GuideStep(
                    "tr_batt", "Remove the battery restriction",
                    "Settings > Apps > PayTrace > Battery",
                    "No restrictions (or Don't optimise), and allow background activity", "Optimised",
                    "Optimised apps are stopped when the screen is off.", Open.APP_DETAILS,
                ),
                GuideStep(
                    "tr_power", "Allow PayTrace in app power management",
                    "Phone Master > Battery > App power management (if your phone lists it)",
                    "Set PayTrace to Allow or Always run", null,
                    "Some Tecno, Infinix and itel phones have a separate list that closes apps.", Open.NONE,
                ),
                LOCK,
            )
            m.contains("huawei") || m.contains("honor") -> listOf(
                GuideStep(
                    "hu_launch", "Let PayTrace run on its own",
                    "Settings > Battery > App launch > PayTrace",
                    "Manage manually, then turn ON Auto-launch, Secondary launch and Run in background", "Automatic",
                    "Automatic management closes apps in the background.", Open.AUTOSTART_PAGE,
                ),
                LOCK,
            )
            else -> listOf(
                GuideStep(
                    "gen_batt", "Remove the battery restriction",
                    "Settings > Apps > PayTrace > Battery",
                    "No restrictions (or Don't optimize)", "Optimized or Restricted",
                    "Restricted apps are stopped in the background.", Open.APP_DETAILS,
                ),
                GuideStep(
                    "gen_auto", "Allow auto-start if the phone has it",
                    "Settings > Apps > PayTrace (look for Autostart, Auto-launch or Background activity)",
                    "Switch it ON", null,
                    "Lets PayTrace start again on its own.", Open.AUTOSTART_PAGE,
                ),
                LOCK,
            )
        }
    }

    /** True once every step of this phone brand's guide has been ticked. */
    fun guideComplete(manufacturer: String?, done: Set<String>): Boolean =
        guide(manufacturer).all { it.id in done }

    // ---- reading the real phone ----

    private fun granted(ctx: Context, permission: String) =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    fun notificationsOn(ctx: Context): Boolean = try {
        NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    } catch (e: Exception) {
        true
    }

    fun batteryExempt(ctx: Context): Boolean = try {
        ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false
    } catch (e: Exception) {
        false
    }

    /** Steps the phone itself can confirm, so the owner does not have to tick them: those that are only about Android's battery optimisation. */
    fun autoVerified(ctx: Context): Set<String> =
        if (batteryExempt(ctx)) setOf("op_battery", "tr_batt", "gen_batt") else emptySet()

    fun state(ctx: Context, settings: AppSettings) = State(
        smsReceive = granted(ctx, Manifest.permission.RECEIVE_SMS),
        smsRead = granted(ctx, Manifest.permission.READ_SMS),
        notifications = notificationsOn(ctx) && (Build.VERSION.SDK_INT < 33 || granted(ctx, Manifest.permission.POST_NOTIFICATIONS)),
        batteryExempt = batteryExempt(ctx),
        autostartNeeded = needsAutostartConfirm(Build.MANUFACTURER),
        autostartConfirmed = guideComplete(Build.MANUFACTURER, settings.guideDone + autoVerified(ctx)),
    )

    fun missing(ctx: Context, settings: AppSettings): List<Req> = missing(state(ctx, settings))
}

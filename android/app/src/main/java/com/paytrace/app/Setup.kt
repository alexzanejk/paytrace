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

    fun state(ctx: Context, settings: AppSettings) = State(
        smsReceive = granted(ctx, Manifest.permission.RECEIVE_SMS),
        smsRead = granted(ctx, Manifest.permission.READ_SMS),
        notifications = notificationsOn(ctx) && (Build.VERSION.SDK_INT < 33 || granted(ctx, Manifest.permission.POST_NOTIFICATIONS)),
        batteryExempt = batteryExempt(ctx),
        autostartNeeded = needsAutostartConfirm(Build.MANUFACTURER),
        autostartConfirmed = settings.autostartConfirmed,
    )

    fun missing(ctx: Context, settings: AppSettings): List<Req> = missing(state(ctx, settings))
}

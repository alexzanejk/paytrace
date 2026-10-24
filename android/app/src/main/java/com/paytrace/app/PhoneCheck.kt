package com.paytrace.app

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build

/** What the phone itself will tell us about how freely PayTrace may run. It cannot read the phone brand's own power manager, which is why
 *  the guide also has a real screen-off test; but these three answers are real, not the owner's word. */
object PhoneCheck {
    enum class Level { GOOD, WARN, BAD, UNKNOWN }

    data class Line(val title: String, val answer: String, val level: Level)

    /** Android's "standby bucket" for an app: how much it is allowed to run. 10 active, 20 working set, 30 frequent, 40 rare, 45 restricted. */
    fun bucketLine(bucket: Int?): Line = when {
        bucket == null -> Line("App standby", "not reported by this phone", Level.UNKNOWN)
        bucket <= 10 -> Line("App standby", "Active", Level.GOOD)
        bucket <= 20 -> Line("App standby", "In regular use", Level.GOOD)
        bucket <= 30 -> Line("App standby", "Used now and then: background work is delayed a little", Level.WARN)
        bucket <= 40 -> Line("App standby", "Rarely used: background work is delayed a lot", Level.BAD)
        bucket < 50 -> Line("App standby", "Restricted: the phone blocks background work", Level.BAD)
        else -> Line("App standby", "Never used", Level.UNKNOWN)
    }

    fun batteryLine(exempt: Boolean): Line =
        if (exempt) Line("Battery optimisation", "Off for PayTrace", Level.GOOD)
        else Line("Battery optimisation", "On: the phone may stop PayTrace to save battery", Level.BAD)

    fun restrictedLine(restricted: Boolean?): Line = when (restricted) {
        null -> Line("Background limit", "not reported by this phone", Level.UNKNOWN)
        true -> Line("Background limit", "Restricted: set the app's battery to \"Unrestricted\"", Level.BAD)
        false -> Line("Background limit", "None", Level.GOOD)
    }

    fun read(ctx: Context): List<Line> {
        val lines = mutableListOf(batteryLine(Setup.batteryExempt(ctx)))
        var restricted: Boolean? = null
        var bucket: Int? = null
        if (Build.VERSION.SDK_INT >= 28) {
            try { restricted = ctx.getSystemService(ActivityManager::class.java)?.isBackgroundRestricted } catch (e: Exception) { }
            try { bucket = ctx.getSystemService(UsageStatsManager::class.java)?.appStandbyBucket } catch (e: Exception) { }
        }
        lines += restrictedLine(restricted)
        lines += bucketLine(bucket)
        return lines
    }
}

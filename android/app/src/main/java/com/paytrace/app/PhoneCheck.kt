package com.paytrace.app

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Build

/** What the phone itself will tell us about how freely PayTrace may run. It cannot read the phone brand's own power manager, which is why
 *  the guide also has a real screen-off test; but these three answers are real, not the owner's word. */
object PhoneCheck {
    enum class Level { GOOD, WARN, BAD, UNKNOWN }

    /** One answer from the phone, in English and in Bangla ([titleBn] / [answerBn]); [text] picks the one for the guide's language. */
    data class Line(val title: String, val answer: String, val level: Level, val titleBn: String = title, val answerBn: String = answer) {
        fun title(l: Lang) = if (l == Lang.BN) titleBn else title
        fun answer(l: Lang) = if (l == Lang.BN) answerBn else answer
    }

    private const val T_STANDBY = "App standby"
    private const val T_STANDBY_BN = "অ্যাপ স্ট্যান্ডবাই"

    /** Android's "standby bucket" for an app: how much it is allowed to run. 10 active, 20 working set, 30 frequent, 40 rare, 45 restricted. */
    fun bucketLine(bucket: Int?): Line = when {
        bucket == null -> Line(T_STANDBY, "not reported by this phone", Level.UNKNOWN, T_STANDBY_BN, "এই ফোন জানায়নি")
        bucket <= 10 -> Line(T_STANDBY, "Active", Level.GOOD, T_STANDBY_BN, "সক্রিয় (Active)")
        bucket <= 20 -> Line(T_STANDBY, "In regular use", Level.GOOD, T_STANDBY_BN, "নিয়মিত ব্যবহৃত")
        bucket <= 30 -> Line(T_STANDBY, "Used now and then: background work is delayed a little", Level.WARN, T_STANDBY_BN, "মাঝে মাঝে ব্যবহৃত: ব্যাকগ্রাউন্ডের কাজ একটু দেরিতে হয়")
        bucket <= 40 -> Line(T_STANDBY, "Rarely used: background work is delayed a lot", Level.BAD, T_STANDBY_BN, "কমই ব্যবহৃত: ব্যাকগ্রাউন্ডের কাজ অনেক দেরিতে হয়")
        bucket < 50 -> Line(T_STANDBY, "Restricted: the phone blocks background work", Level.BAD, T_STANDBY_BN, "সীমাবদ্ধ (Restricted): ফোন ব্যাকগ্রাউন্ডের কাজ আটকে দেয়")
        else -> Line(T_STANDBY, "Never used", Level.UNKNOWN, T_STANDBY_BN, "কখনো ব্যবহৃত হয়নি")
    }

    fun batteryLine(exempt: Boolean): Line =
        if (exempt) Line("Battery optimisation", "Off for PayTrace", Level.GOOD, "ব্যাটারি অপটিমাইজেশন", "PayTrace-এর জন্য বন্ধ আছে")
        else Line("Battery optimisation", "On: the phone may stop PayTrace to save battery", Level.BAD, "ব্যাটারি অপটিমাইজেশন", "চালু আছে: ব্যাটারি বাঁচাতে ফোন PayTrace বন্ধ করে দিতে পারে")

    fun restrictedLine(restricted: Boolean?): Line = when (restricted) {
        null -> Line("Background limit", "not reported by this phone", Level.UNKNOWN, "ব্যাকগ্রাউন্ড সীমা", "এই ফোন জানায়নি")
        true -> Line("Background limit", "Restricted: set the app's battery to \"Unrestricted\"", Level.BAD, "ব্যাকগ্রাউন্ড সীমা", "সীমাবদ্ধ (Restricted): অ্যাপের ব্যাটারি \"Unrestricted\" করুন")
        false -> Line("Background limit", "None", Level.GOOD, "ব্যাকগ্রাউন্ড সীমা", "কোনো সীমা নেই")
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

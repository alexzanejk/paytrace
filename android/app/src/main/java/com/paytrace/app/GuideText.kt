package com.paytrace.app

/** The phone-settings guide in two languages (owner request 2026-10-24: partners read Bangla). English stays in [Setup.guide] and the screens;
 *  this file holds the Bangla for every step and every line of the guide screen, plus the switch between them.
 *
 *  One rule for the Bangla: the phone's own screens are usually in English, so every menu and option name the partner has to find or tap
 *  stays in English, in quotes, exactly as in the English guide. Bangla explains around it. */
enum class Lang(val code: String) {
    BN("bn"), EN("en");

    companion object {
        /** Anything that is not "en" is Bangla, so a new or unknown value never leaves the partner without Bangla. */
        fun of(code: String?): Lang = if (code == "en") EN else BN
    }
}

/** What one step of the guide shows. */
data class StepText(val title: String, val path: String, val choose: String, val avoid: String?, val why: String)

object GuideText {
    private fun pick(lang: Lang, bn: String, en: String) = if (lang == Lang.BN) bn else en

    /** The text of one step in [lang]. A step with no Bangla yet falls back to English instead of showing nothing. */
    fun step(step: Setup.GuideStep, lang: Lang): StepText =
        if (lang == Lang.EN) english(step) else BANGLA[step.id] ?: english(step)

    private fun english(s: Setup.GuideStep) = StepText(s.title, s.path, s.choose, s.avoid, s.why)

    /** Bangla for every step id used by [Setup.guide]. */
    val BANGLA: Map<String, StepText> = mapOf(
        "vivo_bg" to StepText(
            "PayTrace-কে ব্যাকগ্রাউন্ডে ব্যাটারি ব্যবহার করতে দিন",
            "Settings > Battery > Background power consumption management > PayTrace",
            "\"Allow high background power consumption\"",
            "\"Optimized\" বা \"Smart\": এগুলো থাকলে স্ক্রিন বন্ধ হলে ফোন PayTrace বন্ধ করে দেয়",
            "ভিভো ফোনে PayTrace এই সেটিং-এর কারণেই বন্ধ হয়ে গিয়েছিল।",
        ),
        "vivo_autostart" to StepText(
            "PayTrace-কে নিজে থেকে চালু হতে দিন",
            "Settings > Apps & permissions > Autostart (অথবা i Manager > App manager > Autostart)",
            "PayTrace-এর পাশের সুইচটি ON করুন",
            null,
            "এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না।",
        ),
        "vivo_saver" to StepText(
            "পাওয়ার সেভিং মোড বন্ধ রাখুন",
            "Settings > Battery",
            "\"Super power saving\" এবং \"Ultra power saving\": দুটোই OFF",
            null,
            "এই মোড চালু থাকলে ব্যাকগ্রাউন্ডের সব অ্যাপ বন্ধ হয়ে যায়।",
        ),
        "lock" to StepText(
            "Recent apps-এ PayTrace লক করে রাখুন",
            "Recent apps খুলুন (স্ক্রিনের নিচ থেকে উপরে টেনে ধরে রাখুন) এবং PayTrace খুঁজে নিন",
            "PayTrace-এর কার্ডটি নিচের দিকে টানুন, অথবা ছোট তালা (lock) আইকনে চাপ দিন, যতক্ষণ কার্ডে তালা না দেখা যায়",
            null,
            "ফোন পরিষ্কার (clean) করার সময় লক করা অ্যাপ বাদ থাকে, তাই PayTrace বন্ধ হয় না।",
        ),
        "op_battery" to StepText(
            "PayTrace-এর ব্যাটারি অপটিমাইজ করবেন না",
            "Settings > Battery > Battery optimization > PayTrace",
            "\"Don't optimize\"",
            "\"Optimize\"",
            "অপটিমাইজ করা অ্যাপ স্ক্রিন বন্ধ হলে ফোন বন্ধ করে দেয়।",
        ),
        "op_bg" to StepText(
            "ব্যাকগ্রাউন্ড অ্যাক্টিভিটি ও অটো-লঞ্চ চালু করুন",
            "Settings > Apps > App management > PayTrace > Battery usage",
            "\"Allow background activity\": ON এবং \"Allow auto-launch\": ON",
            null,
            "এতে PayTrace চলতে থাকে এবং বন্ধ হয়ে গেলে নিজে থেকে আবার চালু হয়।",
        ),
        "op_sleep" to StepText(
            "স্লিপ অপটিমাইজেশন বন্ধ করুন",
            "Settings > Battery > More battery settings",
            "\"Sleep standby optimization\": OFF এবং \"Deep optimization\": OFF",
            null,
            "এগুলো চালু থাকলে স্ক্রিন বন্ধ অবস্থায় অ্যাপ জমে (freeze) যায়।",
        ),
        "xi_autostart" to StepText(
            "PayTrace-কে নিজে থেকে চালু হতে দিন",
            "Settings > Apps > Manage apps > PayTrace > Autostart",
            "সুইচটি ON করুন",
            null,
            "এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না।",
        ),
        "xi_saver" to StepText(
            "ব্যাটারির বিধিনিষেধ তুলে দিন",
            "Settings > Apps > Manage apps > PayTrace > Battery saver",
            "\"No restrictions\"",
            "\"Battery saver\" বা \"Restricted\"",
            "\"Restricted\" অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়।",
        ),
        "sa_never" to StepText(
            "PayTrace-কে \"Never sleeping apps\"-এর তালিকায় যোগ করুন",
            "Settings > Battery > Background usage limits > Never sleeping apps",
            "তালিকায় PayTrace যোগ করুন",
            "PayTrace যদি \"Sleeping apps\" বা \"Deep sleeping apps\"-এর তালিকায় থাকে, সেখান থেকে সরান",
            "\"Sleeping apps\"-এর অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়।",
        ),
        "sa_unused" to StepText(
            "অব্যবহৃত অ্যাপকে ঘুম পাড়ানো বন্ধ করুন",
            "Settings > Battery > Background usage limits",
            "\"Put unused apps to sleep\": OFF",
            null,
            "না হলে আপনি PayTrace না খুললে স্যামসাং সেটিকে ঘুম পাড়িয়ে দেয়।",
        ),
        "tr_auto" to StepText(
            "PayTrace-কে নিজে থেকে চালু হতে দিন",
            "Phone Master (অথবা Settings) > Autostart manager",
            "PayTrace-এর সুইচটি ON করুন",
            null,
            "এটা না থাকলে ফোন একবার বন্ধ করে দিলে PayTrace আর নিজে থেকে চালু হতে পারে না।",
        ),
        "tr_batt" to StepText(
            "ব্যাটারির বিধিনিষেধ তুলে দিন",
            "Settings > Apps > PayTrace > Battery",
            "\"No restrictions\" (অথবা \"Don't optimise\") বাছুন এবং ব্যাকগ্রাউন্ড অ্যাক্টিভিটির অনুমতি দিন",
            "\"Optimised\"",
            "অপটিমাইজ করা অ্যাপ স্ক্রিন বন্ধ হলে ফোন বন্ধ করে দেয়।",
        ),
        "tr_power" to StepText(
            "App power management-এ PayTrace-কে অনুমতি দিন",
            "Phone Master > Battery > App power management (আপনার ফোনে থাকলে)",
            "PayTrace-কে \"Allow\" অথবা \"Always run\" করুন",
            null,
            "কিছু Tecno, Infinix ও itel ফোনে আলাদা একটি তালিকা আছে, যা অ্যাপ বন্ধ করে দেয়।",
        ),
        "hu_launch" to StepText(
            "PayTrace-কে নিজে থেকে চলতে দিন",
            "Settings > Battery > App launch > PayTrace",
            "\"Manage manually\" বাছুন, তারপর \"Auto-launch\", \"Secondary launch\" ও \"Run in background\" ON করুন",
            "\"Automatic\"",
            "\"Automatic\" থাকলে ফোন নিজে থেকে ব্যাকগ্রাউন্ডের অ্যাপ বন্ধ করে দেয়।",
        ),
        "gen_batt" to StepText(
            "ব্যাটারির বিধিনিষেধ তুলে দিন",
            "Settings > Apps > PayTrace > Battery",
            "\"No restrictions\" (অথবা \"Don't optimize\")",
            "\"Optimized\" বা \"Restricted\"",
            "\"Restricted\" অ্যাপ ব্যাকগ্রাউন্ডে বন্ধ করে দেওয়া হয়।",
        ),
        "gen_auto" to StepText(
            "ফোনে থাকলে অটো-স্টার্ট চালু করুন",
            "Settings > Apps > PayTrace (এখানে \"Autostart\", \"Auto-launch\" বা \"Background activity\" খুঁজুন)",
            "সুইচটি ON করুন",
            null,
            "এতে PayTrace বন্ধ হয়ে গেলে নিজে থেকে আবার চালু হতে পারে।",
        ),
    )

    // ---- the names shown after "Opened: ..." ----

    private val WAY_BN: Map<String, String> = mapOf(
        "app_info" to "PayTrace-এর নিজের অ্যাপ পেজ (এখান থেকে Battery বা Permissions খুলুন)",
        "settings_home" to "ফোনের Settings-এর হোম (সেটিং-এর নাম লিখে খুঁজুন)",
        "batt_dialog" to "\"PayTrace-কে ব্যাকগ্রাউন্ডে চলতে দিন\" প্রশ্নটি",
        "batt_list" to "ব্যাটারি অপটিমাইজেশনের তালিকা (\"All apps\" বেছে PayTrace খুঁজুন)",
        "batt_saver" to "ব্যাটারি সেভার পেজ",
        "power_usage" to "ব্যাটারি ব্যবহারের পেজ",
        "vivo_wl" to "ভিভো: যে অ্যাপ বেশি ব্যাকগ্রাউন্ড পাওয়ার ব্যবহার করতে পারে",
        "vivo_auto" to "ভিভো: ব্যাকগ্রাউন্ড স্টার্টআপ ম্যানেজার",
        "vivo_perm" to "ভিভো: পারমিশন ম্যানেজার",
        "op_chain" to "ওয়ানপ্লাস: অটো-লঞ্চের তালিকা",
        "color_start" to "ColorOS: স্টার্টআপ অ্যাপের তালিকা",
        "color_start2" to "ColorOS: স্টার্টআপ অ্যাপের তালিকা",
        "oppo_start" to "অপো: স্টার্টআপ অ্যাপের তালিকা",
        "oplus_power" to "ColorOS: পাওয়ার ব্যবহারের সেটিং",
        "miui_auto" to "শাওমি: অটোস্টার্ট ম্যানেজার",
        "miui_saver" to "শাওমি: PayTrace-এর ব্যাটারি সেভার সেটিং",
        "sam_batt" to "স্যামসাং: ডিভাইস কেয়ারের ব্যাটারি পেজ",
        "sam_batt2" to "স্যামসাং: ডিভাইস কেয়ারের ব্যাটারি পেজ",
        "hw_start" to "হুয়াওয়ে: স্টার্টআপ ম্যানেজার",
        "hw_protect" to "হুয়াওয়ে: প্রোটেক্টেড অ্যাপ",
        "hw_power" to "হুয়াওয়ে: পাওয়ার ম্যানেজার",
        "tr_pm" to "Phone Master: অটোস্টার্ট ম্যানেজার",
        "tr_power" to "Transsion: অটোস্টার্ট ম্যানেজার",
        "tr_hios" to "HiOS: অটোস্টার্ট ম্যানেজার",
        "asus_auto" to "আসুস: অটোস্টার্ট ম্যানেজার",
    )

    /** The Bangla name of a page, or null if it has none. Pages built from the brand's own list ("oem_...") share one name. */
    fun wayLabelBn(id: String): String? = WAY_BN[id] ?: if (id.startsWith("oem_")) "ফোন কোম্পানির নিজের অটোস্টার্ট পেজ" else null

    fun wayLabel(w: Way, lang: Lang): String = if (lang == Lang.EN) w.label else wayLabelBn(w.id) ?: w.label

    // ---- the words on the guide screen ----

    fun whereLabel(l: Lang) = pick(l, "কোথায়:", "Where:")
    fun chooseLabel(l: Lang) = pick(l, "বেছে নিন:", "Choose:")
    fun notLabel(l: Lang) = pick(l, "বেছে নেবেন না:", "Not:")
    fun openThisPage(l: Lang) = pick(l, "এই পেজটি খুলুন", "Open this page")
    fun opened(l: Lang) = pick(l, "খুলেছে:", "Opened:")
    fun tryAnother(l: Lang) = pick(l, "ভুল পেজ? অন্যটি চেষ্টা করুন", "Not the right page? Try another")
    fun startAgain(l: Lang) = pick(l, "প্রথম পেজ থেকে আবার শুরু করুন", "Start again from the first page")
    fun openAppPage(l: Lang) = pick(l, "PayTrace-এর অ্যাপ পেজ খুলুন", "Open PayTrace's app page")
    fun iDidThis(l: Lang) = pick(l, "আমি এটা করেছি", "I did this")
    fun done(l: Lang) = pick(l, "✓ হয়ে গেছে", "✓ Done")
    fun undo(l: Lang) = pick(l, "ফিরিয়ে নিন", "Undo")
    fun phoneConfirms(l: Lang) = pick(l, "✓ ফোন নিজেই নিশ্চিত করেছে", "✓ The phone confirms this one")

    fun progress(l: Lang, finished: Int, total: Int) =
        if (finished == total) pick(l, "সবগুলো ($total টি) সেটিং শেষ। ধন্যবাদ।", "All $total settings are done. Thank you.")
        else pick(l, "$total টির মধ্যে $finished টি সেটিং শেষ", "$finished of $total settings done")

    fun phoneCheckTitle(l: Lang) = pick(l, "ফোন চেক", "Phone check")
    fun phoneCheckNote(l: Lang) = pick(
        l,
        "অ্যান্ড্রয়েড নিজে যা জানায়, এখানে তা-ই দেখানো হয়েছে। ফোন কোম্পানির নিজস্ব পাওয়ার ম্যানেজার নিচের স্ক্রিন-অফ টেস্টে পরীক্ষা হয়।",
        "This is what Android reports. Your phone brand's own power manager is checked by the screen-off test below.",
    )

    fun footer(l: Lang) = pick(
        l,
        "ফোনের মডেল অনুযায়ী লেখা একটু আলাদা হতে পারে। কোনো পেজ ভুল বা খালি খুললে \"ভুল পেজ? অন্যটি চেষ্টা করুন\" চাপুন। শেষ দুটি অপশন PayTrace-এর অ্যাপ পেজ ও ফোনের Settings, যা সব ফোনেই আছে।",
        "Wording differs a little between phone models. If a page is wrong or empty, tap \"Try another page\"; the last choices are PayTrace's own app page and the phone's Settings, which every phone has.",
    )

    // ---- the screen-off test card ----

    fun testTitle(l: Lang) = pick(l, "স্ক্রিন-অফ টেস্ট", "Screen-off test")
    fun testIdle(l: Lang) = pick(
        l,
        "প্রস্তাবিত। টেস্ট শুরু করে ফোন লক করুন এবং 10 মিনিট রেখে দিন। ওপরের সেটিংগুলো কাজ করেছে কি না, PayTrace তখন আপনাকে জানাবে।",
        "Recommended. Start the test, lock the phone and leave it for 10 minutes. PayTrace then tells you whether the phone stopped it, which is what the settings above are for.",
    )
    fun testRunning(l: Lang, minutesLeft: Int) = pick(
        l,
        "টেস্ট চলছে। এখনই ফোন লক করে রেখে দিন। আরও প্রায় $minutesLeft মিনিট পর PayTrace খুলে ফলাফল দেখুন।",
        "Test running. Lock the phone now and put it down. Come back in about $minutesLeft minute(s) and open PayTrace to see the result.",
    )
    fun testPass(l: Lang, at: String, offMin: Int, gapS: Int): String {
        val whenText = if (at.isEmpty()) "" else " ($at)"
        return pick(
            l,
            "✓ পাস$whenText: স্ক্রিন বন্ধ থাকা অবস্থায় $offMin মিনিট PayTrace চালু ছিল। সবচেয়ে বড় বিরতি ছিল $gapS সেকেন্ড।",
            "✓ Passed$whenText: PayTrace kept running with the screen off for $offMin minutes. The longest silence was $gapS seconds.",
        )
    }
    fun testFail(l: Lang, at: String, gapS: Int): String {
        val whenText = if (at.isEmpty()) "" else " ($at)"
        return pick(
            l,
            "ফেল$whenText: PayTrace $gapS সেকেন্ড চুপ ছিল, অর্থাৎ ফোন এটি বন্ধ করে দিয়েছিল। ওপরের সেটিংগুলো আবার দেখুন, তারপর আবার টেস্ট করুন।",
            "Failed$whenText: PayTrace was silent for $gapS seconds, so the phone stopped it. Go through the settings above again, then test again.",
        )
    }
    fun testShort(l: Lang, offMin: Int) = pick(
        l,
        "টেস্ট নিশ্চিত হতে পারেনি: স্ক্রিন মাত্র $offMin মিনিট বন্ধ ছিল। পুরো সময় ফোন লক করে রাখুন।",
        "The test could not tell: the screen was off for only $offMin minutes. Lock the phone and leave it the whole time.",
    )
    fun testStart(l: Lang) = pick(l, "10 মিনিটের টেস্ট শুরু করুন", "Start the 10-minute test")
    fun testAgain(l: Lang) = pick(l, "আবার টেস্ট করুন", "Test again")
    fun testCancel(l: Lang) = pick(l, "টেস্ট বাতিল করুন", "Cancel the test")

    /** Every fixed line of the screen in one language, so a test can check none was forgotten. */
    fun allScreenTexts(l: Lang): List<String> = listOf(
        whereLabel(l), chooseLabel(l), notLabel(l), openThisPage(l), opened(l), tryAnother(l), startAgain(l), openAppPage(l), iDidThis(l), done(l),
        undo(l), phoneConfirms(l), progress(l, 1, 3), progress(l, 3, 3), phoneCheckTitle(l), phoneCheckNote(l), footer(l), testTitle(l), testIdle(l),
        testRunning(l, 7), testPass(l, "Fri 23 Oct, 3:05 PM", 10, 31), testFail(l, "", 240), testShort(l, 3), testStart(l), testAgain(l), testCancel(l),
    )
}

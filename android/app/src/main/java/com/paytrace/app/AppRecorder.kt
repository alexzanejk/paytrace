package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.app.NotificationCompat
import java.util.Locale

/** Test step 1 of reading the bKash Agent APP instead of the *247# statement (owner 2026-11-10: "on dial it only shows 6,
 *  we are missing so many transactions ... test on the Vivo first"). The app's own transaction list goes back days and
 *  prints the exact time of every entry, which the USSD statement never does.
 *
 *  Before PayTrace can drive that app by itself we must SEE what Android lets an accessibility service read from it
 *  (banking apps can hide their screens from such services). So this is a recorder, nothing more: the dashboard sends
 *  "apprecord", the phone opens the bKash app, and for [RUN_MS] PayTrace writes down the words on every screen of the
 *  bKash app while a person logs in and scrolls the transaction list by hand. The words go back as the command's screens.
 *
 *  It never types, taps or scrolls anything, it reads only windows of an app whose package name contains "bkash", it never
 *  reads a box being typed into (isEditable / isPassword), and on a PIN screen it drops anything that looks like a PIN. */
object AppRecorder {
    const val KIND = "apprecord"

    /** The server fails a command that runs for 3 minutes, so the recording stops well before. */
    const val RUN_MS = 150_000L
    /** Once the bKash app has been seen, leaving it for this long ends the recording early. */
    const val GONE_MS = 40_000L
    private const val TICK_MS = 700L
    private const val MAX_SCREENS = 80
    private const val MAX_NODES = 800
    const val CHUNKS = 12
    const val CHUNK_CHARS = 2000
    /** The server refuses a message over 20,000 characters (and newlines count twice once sent), so the whole answer is
     *  kept well under it. The first test on the Vivo (2026-11-10) filled all 12 screens and was refused three times. */
    const val TOTAL_CHARS = 14_000

    @Volatile private var running = false

    fun isBkash(pkg: String?): Boolean = pkg != null && pkg.lowercase(Locale.ROOT).contains("bkash")

    /** One screen's lines with the PIN kept out: on a screen that asks for a PIN, a bare run of 4 to 6 digits is dropped
     *  (the keys of a keypad are single digits and stay). Blank lines go. */
    fun safeLines(lines: List<String>): List<String> {
        val clean = lines.map { it.replace('\n', ' ').trim() }.filter { it.isNotEmpty() }
        val asksPin = clean.any { val l = it.lowercase(Locale.ROOT); "pin" in l || "পিন" in l }
        return if (!asksPin) clean else clean.filterNot { Regex("^[0-9০-৯•●*\\s]{4,12}$").matches(it) && it.count { c -> c.isDigit() } >= 4 }
    }

    /** What is new on [cur] after scrolling from [prev]: the lines at the top of [cur] that were already at the bottom of
     *  [prev] are left out, so a long list costs little room. */
    fun newPart(prev: List<String>, cur: List<String>): List<String> {
        val most = minOf(prev.size, cur.size)
        for (k in most downTo 1) {
            if (prev.subList(prev.size - k, prev.size) == cur.subList(0, k)) return cur.subList(k, cur.size)
        }
        return cur
    }

    /** The header and the screens packed into at most [CHUNKS] texts of [CHUNK_CHARS] (what command_result carries).
     *  Screens that do not fit are counted in the header instead of being cut silently. */
    fun pack(header: String, screens: List<String>): List<String> {
        val room = minOf((CHUNKS - 1) * CHUNK_CHARS, TOTAL_CHARS - header.length - 80)
        val sep = "\n=====\n"
        val fits = { list: List<String> -> list.sumOf { it.length } + sep.length * list.size <= room }
        // Everything if it fits. Otherwise the first two screens (how the app opens and logs in) and as many of the LAST
        // screens as fit (the end of the list and the transaction that was opened), with the middle left out and said so.
        val chosen: List<String> = if (fits(screens)) screens else {
            val head = screens.take(2).filter { it.length <= room / 3 }
            val tail = ArrayList<String>()
            var used = head.sumOf { it.length + sep.length } + 60
            for (s in screens.drop(minOf(2, screens.size)).asReversed()) {
                val cut = s.take(room / 2)
                if (used + cut.length + sep.length > room) break
                tail.add(0, cut)
                used += cut.length + sep.length
            }
            val left = screens.size - minOf(2, screens.size) - tail.size
            head + listOf("($left screens in the middle left out)") + tail
        }
        val body = chosen.joinToString(sep).take(room)
        val out = ArrayList<String>()
        out.add((header + "\nscreens: ${screens.size}, sent: ${chosen.size}").take(CHUNK_CHARS))
        var i = 0
        while (i < body.length && out.size < CHUNKS) {
            out.add(body.substring(i, minOf(body.length, i + CHUNK_CHARS)))
            i += CHUNK_CHARS
        }
        return out
    }

    /** The bKash app installed on this phone (the agent app if there are two), found among the launcher's apps. */
    fun findApp(ctx: Context): String? {
        val pm = ctx.packageManager
        val all = try {
            pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
                .map { it.activityInfo.packageName }.distinct().filter { isBkash(it) }
        } catch (e: Exception) { emptyList() }
        return all.firstOrNull { it.lowercase(Locale.ROOT).contains("agent") } ?: all.firstOrNull()
    }

    fun start(ctx: Context, done: (UssdOutcome) -> Unit) {
        val app = ctx.applicationContext
        val svc = UssdSession.launchContext() as? AccessibilityService
            ?: return done(UssdOutcome(false, null, "accessibility_not_running"))
        if (running || UssdSession.active() || UssdApi.active()) return done(UssdOutcome(false, null, "busy"))
        val pkg = findApp(app) ?: return done(UssdOutcome(false, null, "no_bkash_app"))
        running = true
        notifyPerson(app)
        try {
            svc.startActivity(app.packageManager.getLaunchIntentForPackage(pkg)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // The person can open it by hand; the notice says so.
        }
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        var lastSeen = 0L
        var prev: List<String> = emptyList()
        val screens = ArrayList<String>()
        val others = LinkedHashSet<String>()
        var secured = false

        fun finish() {
            running = false
            val version = try { app.packageManager.getPackageInfo(pkg, 0).versionName ?: "?" } catch (e: Exception) { "?" }
            val header = "bKash app read (test)\npackage: $pkg\nversion: $version\nother windows seen: " +
                others.take(8).joinToString(", ") + (if (secured) "\nnote: some boxes were not read (typing / PIN)" else "")
            if (screens.isEmpty()) {
                done(UssdOutcome(false, null, "app_not_readable", trace = header, screens = listOf(header)))
            } else {
                done(UssdOutcome(true, null, null, screens = pack(header, screens)))
            }
        }

        val tick = object : Runnable {
            override fun run() {
                val now = SystemClock.elapsedRealtime()
                try {
                    val roots = ArrayList<AccessibilityNodeInfo>()
                    svc.rootInActiveWindow?.let { roots.add(it) }
                    try { svc.windows?.forEach { w -> w.root?.let { roots.add(it) } } } catch (e: Exception) { }
                    val root = roots.firstOrNull { isBkash(it.packageName?.toString()) }
                    if (root == null) {
                        roots.mapNotNull { it.packageName?.toString() }.filter { it != app.packageName }.forEach { if (others.size < 20) others.add(it) }
                    } else {
                        lastSeen = now
                        val lines = ArrayList<String>()
                        val count = intArrayOf(0)
                        if (read(root, lines, count, 0)) secured = true
                        val safe = safeLines(lines)
                        if (safe.isNotEmpty() && safe != prev && screens.size < MAX_SCREENS) {
                            val part = newPart(prev, safe)
                            if (part.isNotEmpty()) screens.add(part.joinToString("\n"))
                            prev = safe
                        }
                    }
                } catch (e: Exception) {
                    // A window that closed while being read; the next tick reads again.
                }
                val over = now - started >= RUN_MS || (lastSeen > 0 && now - lastSeen >= GONE_MS)
                if (over) finish() else main.postDelayed(this, TICK_MS)
            }
        }
        main.postDelayed(tick, 1500)
    }

    /** Every word on the screen in reading order; a "»" line marks the start of a tappable row, so rows can be told
     *  apart later. Returns true when a typed-into box was skipped. */
    private fun read(n: AccessibilityNodeInfo?, out: MutableList<String>, count: IntArray, depth: Int): Boolean {
        if (n == null || depth > 40 || count[0] > MAX_NODES) return false
        count[0]++
        if (n.isPassword || n.isEditable) return true
        var skipped = false
        if (n.isClickable && n.childCount > 0) out.add("»")
        n.text?.toString()?.let { out.add(it) }
        val d = n.contentDescription?.toString()
        if (!d.isNullOrBlank() && d != n.text?.toString()) out.add("[$d]")
        for (i in 0 until n.childCount) {
            if (read(n.getChild(i), out, count, depth + 1)) skipped = true
        }
        return skipped
    }

    private fun notifyPerson(app: Context) {
        try {
            val nm = app.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reading the bKash app (test)", NotificationManager.IMPORTANCE_HIGH))
            nm.notify(
                NOTIF_ID,
                NotificationCompat.Builder(app, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("PayTrace is reading the bKash app (2½ minutes)")
                    .setContentText("Log in, open the transaction list and scroll slowly. Open one transaction.")
                    .setStyle(NotificationCompat.BigTextStyle().bigText(
                        "Test for the owner: log in to the bKash app, open the transaction list, scroll down slowly to the oldest " +
                            "entries, and open one transaction. PayTrace only reads the screen; it never taps or types anything.",
                    ))
                    .setAutoCancel(true)
                    .setTimeoutAfter(RUN_MS)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .build(),
            )
        } catch (e: Exception) {
        }
    }

    private const val CHANNEL = "app_record"
    private const val NOTIF_ID = 47
}

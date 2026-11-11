package com.paytrace.app

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.graphics.Rect
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors

/** Test step 1 of reading the bKash Agent APP instead of the *247# statement (owner 2026-11-10: "on dial it only shows 6,
 *  we are missing so many transactions ... test on the Vivo first"). The app's own transaction list goes back days and
 *  prints the exact time of every entry, which the USSD statement never does.
 *
 *  Before PayTrace can drive that app by itself we must SEE what Android lets an accessibility service read from it
 *  (banking apps can hide their screens from such services). So this is a recorder, nothing more: the dashboard sends
 *  "apprecord", the phone opens the bKash app, answers the command at once, and for up to [MAP_MS] sends every new screen
 *  of the bKash app to the server (ingest "app_screen", table app_screens) while a person goes through the app by hand.
 *  Each element keeps its hidden name (view id), kind, words, hint, flags and position (owner 2026-11-10: "you have
 *  permission to see everything on the record ... we need to map it perfect"); a password box gives only its length.
 *
 *  It never types, taps or scrolls anything and reads only windows of an app whose package name contains "bkash" (other
 *  apps on screen are named, never read). */
object AppRecorder {
    const val KIND = "apprecord"

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

    /** How long one mapping session records (owner 2026-11-10: "we need to map it perfect"). The command is answered
     *  at once and the screens go to the server one by one, so the server's 3-minute command limit does not apply. */
    const val MAP_MS = 600_000L
    /** Away from the bKash app this long (after it was seen) ends the session. */
    const val AWAY_MS = 120_000L
    const val MAX_SENT = 600
    const val SCREEN_CHARS = 8_500
    private const val NODE_TEXT = 300

    /** One element as a line: indent by depth, its kind, hidden name (view id, the same in Bangla and English), words,
     *  description, hint, flags (c tap, l long-press, e typing box, p PIN/password box, s scrolls, x disabled, k ticked,
     *  v selected, f focused) and where it is on the screen. A password box gives only how many characters it holds. */
    fun nodeLine(depth: Int, cls: String?, id: String?, text: String?, desc: String?, hint: String?, flags: String, bounds: String?): String {
        fun clip(t: String?) = t?.replace('\n', ' ')?.trim()?.take(NODE_TEXT)?.takeIf { it.isNotEmpty() }
        val sb = StringBuilder(" ".repeat(minOf(depth, 15)))
        sb.append(cls?.substringAfterLast('.')?.ifBlank { null } ?: "?")
        id?.substringAfter(":id/")?.takeIf { it.isNotBlank() }?.let { sb.append('#').append(it) }
        clip(text)?.let { sb.append(" \"").append(it).append('"') }
        clip(desc)?.takeIf { it != clip(text) }?.let { sb.append(" [").append(it).append(']') }
        clip(hint)?.takeIf { it != clip(text) }?.let { sb.append(" {").append(it).append('}') }
        if (flags.isNotEmpty()) sb.append(" <").append(flags).append('>')
        bounds?.let { sb.append(" @").append(it) }
        return sb.toString()
    }

    /** A screen without positions, to tell a new screen from the same one still moving (animations, a scroll settling). */
    fun signature(lines: List<String>): String = lines.joinToString("\n") { it.substringBeforeLast(" @") }

    /** The text sent for one screen: a header line, then the elements, cut to [SCREEN_CHARS] and said so. */
    fun screenText(seq: Int, secs: Long, pkg: String, others: Collection<String>, lines: List<String>): String {
        val head = "#$seq +${secs}s pkg=$pkg" + if (others.isEmpty()) "" else " also=" + others.joinToString(",")
        val sb = StringBuilder(head)
        var shown = 0
        for (l in lines) {
            if (sb.length + l.length + 1 > SCREEN_CHARS - 60) break
            sb.append('\n').append(l); shown++
        }
        if (shown < lines.size) sb.append("\n(cut: ${lines.size - shown} more elements)")
        return sb.toString()
    }

    fun recording(): Boolean = running

    fun start(ctx: Context, commandId: String?, done: (UssdOutcome) -> Unit) = start(ctx, commandId, "bkash", done)

    /** [target] "nagad" records the Nagad agent app instead (owner 2026-11-11), the same way. */
    fun start(ctx: Context, commandId: String?, target: String, done: (UssdOutcome) -> Unit) {
        val nagad = target == NagadRead.APP
        val name = if (nagad) "Nagad" else "bKash"
        val match: (String?) -> Boolean = if (nagad) { p -> NagadRead.isNagad(p) } else { p -> isBkash(p) }
        val app = ctx.applicationContext
        val svc = UssdSession.launchContext() as? AccessibilityService
            ?: return done(UssdOutcome(false, null, "accessibility_not_running"))
        if (running || AppReader.active() || UssdSession.active() || UssdApi.active()) return done(UssdOutcome(false, null, "busy"))
        val pkg = (if (nagad) NagadApp.findApp(app) else findApp(app)) ?: return done(UssdOutcome(false, null, if (nagad) "no_nagad_app" else "no_bkash_app"))
        val command = commandId?.takeIf { Regex("^[0-9a-fA-F-]{36}$").matches(it) } ?: return done(UssdOutcome(false, null, "bad_command"))
        running = true
        notifyPerson(app, name)
        try {
            svc.startActivity(app.packageManager.getLaunchIntentForPackage(pkg)!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            // The person can open it by hand; the notice says so.
        }
        val version = try { app.packageManager.getPackageInfo(pkg, 0).versionName ?: "?" } catch (e: Exception) { "?" }
        // Answered at once: the screens follow one by one (app_screens on the server).
        done(UssdOutcome(true, null, null, screens = listOf(
            "$name app recording started: up to ${MAP_MS / 60_000} minutes, every new screen is sent to the server as it appears\npackage: $pkg\nversion: $version")))

        val settings = AppSettings(app)
        val sender = Executors.newSingleThreadExecutor()
        val main = Handler(Looper.getMainLooper())
        val started = SystemClock.elapsedRealtime()
        var lastSeen = 0L
        var candidate = ""
        var lastSent = ""
        var seq = 0
        var failed = 0

        fun send(text: String) {
            val n = ++seq
            sender.execute {
                val body = JSONObject().put("action", "app_screen").put("command_id", command).put("seq", n).put("pkg", pkg).put("screen", text).toString()
                var ok = false
                for (attempt in 1..3) {
                    if (JobsApi.post(settings, body) != null) { ok = true; break }
                    try { Thread.sleep(2_000L * attempt) } catch (e: InterruptedException) { break }
                }
                if (!ok) failed++
            }
        }

        fun finish(why: String) {
            if (!running) return
            running = false
            val secs = (SystemClock.elapsedRealtime() - started) / 1000
            if (seq < MAX_SENT) send("#end +${secs}s pkg=$pkg\nstopped: $why\nscreens sent: $seq, not delivered so far: $failed\nversion: $version")
            sender.shutdown()
        }

        val tick = object : Runnable {
            override fun run() {
                if (!running) return
                val now = SystemClock.elapsedRealtime()
                try {
                    val roots = ArrayList<AccessibilityNodeInfo>()
                    try { svc.windows?.forEach { w -> w.root?.let { roots.add(it) } } } catch (e: Exception) { }
                    if (roots.isEmpty()) svc.rootInActiveWindow?.let { roots.add(it) }
                    val mine = roots.filter { match(it.packageName?.toString()) }
                    val others = roots.mapNotNull { it.packageName?.toString() }.filter { !match(it) && it != app.packageName }.distinct().take(5)
                    if (mine.isNotEmpty()) {
                        lastSeen = now
                        val lines = ArrayList<String>()
                        val count = intArrayOf(0)
                        mine.forEachIndexed { i, r -> if (mine.size > 1) lines.add("--- window ${i + 1} of ${mine.size}"); deep(r, lines, count, 0) }
                        val sig = signature(lines)
                        // Sent once the screen has held still for one tick, and only when it differs from the last one sent.
                        if (sig == candidate && sig != lastSent && seq < MAX_SENT) {
                            send(screenText(seq + 1, (now - started) / 1000, pkg, others, lines))
                            lastSent = sig
                        }
                        candidate = sig
                    }
                } catch (e: Exception) {
                    // A window that closed while being read; the next tick reads again.
                }
                when {
                    now - started >= MAP_MS -> finish("10 minutes are up")
                    lastSeen > 0 && now - lastSeen >= AWAY_MS -> finish("the $name app was not on screen for 2 minutes")
                    lastSeen == 0L && now - started >= AWAY_MS -> finish("the $name app never came on screen")
                    seq >= MAX_SENT -> finish("screen limit")
                    else -> main.postDelayed(this, TICK_MS)
                }
            }
        }
        main.postDelayed(tick, 1500)
    }

    /** Every element of a window as [nodeLine]s, in screen order. Elements with nothing to say are left out, but their
     *  children are still read. */
    private fun deep(n: AccessibilityNodeInfo?, out: MutableList<String>, count: IntArray, depth: Int) {
        if (n == null || depth > 40 || count[0] > MAX_NODES) return
        count[0]++
        val flags = StringBuilder()
        if (n.isClickable) flags.append('c')
        if (n.isLongClickable) flags.append('l')
        if (n.isEditable) flags.append('e')
        if (n.isPassword) flags.append('p')
        if (n.isScrollable) flags.append('s')
        if (!n.isEnabled) flags.append('x')
        if (n.isChecked) flags.append('k')
        if (n.isSelected) flags.append('v')
        if (n.isFocused) flags.append('f')
        val text = if (n.isPassword) n.text?.let { "•×${it.length}" } else n.text?.toString()
        val hint = if (android.os.Build.VERSION.SDK_INT >= 26) n.hintText?.toString() else null
        val id = n.viewIdResourceName
        val desc = n.contentDescription?.toString()
        if (!text.isNullOrBlank() || !desc.isNullOrBlank() || !hint.isNullOrBlank() || !id.isNullOrBlank() || flags.isNotEmpty()) {
            val r = Rect()
            n.getBoundsInScreen(r)
            out.add(nodeLine(depth, n.className?.toString(), id, text, desc, hint, flags.toString(), "${r.left},${r.top},${r.right},${r.bottom}"))
        }
        for (i in 0 until n.childCount) deep(n.getChild(i), out, count, depth + 1)
    }

    private fun notifyPerson(app: Context, name: String) {
        try {
            val nm = app.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Reading the bKash app (test)", NotificationManager.IMPORTANCE_HIGH))
            nm.notify(
                NOTIF_ID,
                NotificationCompat.Builder(app, CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("PayTrace is recording the $name app (10 minutes)")
                    .setContentText("Go through the screens slowly. Wait a second on each one.")
                    .setStyle(NotificationCompat.BigTextStyle().bigText(
                        "Mapping the $name app for the owner: go through the screens slowly and wait a second on each one, so it " +
                            "is saved. PayTrace only reads the screen; it never taps or types anything. It stops after 10 minutes " +
                            "or 2 minutes after you leave the $name app.",
                    ))
                    .setAutoCancel(true)
                    .setTimeoutAfter(MAP_MS)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .build(),
            )
        } catch (e: Exception) {
        }
    }

    private const val CHANNEL = "app_record"
    private const val NOTIF_ID = 47
}

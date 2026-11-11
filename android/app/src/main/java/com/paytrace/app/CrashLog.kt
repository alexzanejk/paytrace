package com.paytrace.app

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Typeface
import android.os.Build
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** The whole app process: the first thing it does is catch crashes (CrashLog), so a phone that cannot start PayTrace can
 *  still say why (owner 2026-11-11: Realme C12 "kicking out" on every start, like the Oppo A15 before it). */
class PayTraceApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
    }
}

/** Keeps the last crash in the app's own files and shows it on the next start, so the owner can send a screenshot instead
 *  of an adb log. Never sent anywhere by itself; never holds a PIN (a crash report is the code's own error text). */
object CrashLog {
    private const val FILE = "last_crash.txt"
    const val MAX_CHARS = 6_000

    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                File(app.filesDir, FILE).writeText(format(System.currentTimeMillis(), version(app), Build.MANUFACTURER,
                    Build.MODEL, Build.VERSION.RELEASE, Build.VERSION.SDK_INT, thread.name, Log.getStackTraceString(error)))
            } catch (e: Throwable) {
                // Nothing more can be done; Android shows its own "app stopped" next.
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** The report as shown on the phone. Pure, unit tested. */
    fun format(at: Long, version: String, maker: String, model: String, release: String, sdk: Int, thread: String, stack: String): String {
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(at))
        return ("PayTrace $version crashed at $time\n$maker $model, Android $release (API $sdk), thread $thread\n\n$stack").take(MAX_CHARS)
    }

    fun read(ctx: Context): String? = try {
        File(ctx.filesDir, FILE).takeIf { it.exists() }?.readText()?.takeIf { it.isNotBlank() }
    } catch (e: Throwable) { null }

    fun clear(ctx: Context) {
        try { File(ctx.filesDir, FILE).delete() } catch (e: Throwable) { }
    }

    private fun version(ctx: Context): String = try {
        @Suppress("DEPRECATION")
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "?"
    } catch (e: Throwable) { "?" }

    /** A plain screen (no Compose, no service started) with the report, Copy, and Open PayTrace. Returns true when shown. */
    fun showIfAny(activity: Activity, openAnyway: () -> Unit): Boolean {
        val report = read(activity) ?: return false
        val pad = (16 * activity.resources.displayMetrics.density).toInt()
        val title = TextView(activity).apply {
            text = "PayTrace stopped last time. Please send a screenshot of this screen (or press Copy and send the text)."
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
        }
        val body = TextView(activity).apply {
            text = report
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(0, pad, 0, pad)
        }
        val copy = Button(activity).apply {
            text = "Copy"
            setOnClickListener {
                try {
                    activity.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("PayTrace crash", report))
                    text = "Copied"
                } catch (e: Throwable) { }
            }
        }
        val open = Button(activity).apply {
            text = "Open PayTrace"
            setOnClickListener { clear(activity); openAnyway() }
        }
        val col = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
            addView(title); addView(copy); addView(open); addView(body)
        }
        activity.setContentView(ScrollView(activity).apply { addView(col) })
        return true
    }
}

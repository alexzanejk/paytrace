package com.paytrace.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import org.json.JSONObject

/** The short form of a job that rides back on every heartbeat (about every 30 seconds), enough to ring the phone and name the agent.
 *  The full job (instruction, wallet address) is shown inside the app. */
data class JobBrief(val provider: String, val agent: String, val urgency: String, val balance: Double, val balanceAt: String)

/** When to ring. Pure, so it is unit tested. A job rings the moment it first appears (its balance reading is new), and again every
 *  [REPEAT_MS] while it is still open, so an agent who missed it is reminded. A job that comes back after Done rings at once, because
 *  it comes back with a newer balance reading. */
object JobAlertPolicy {
    const val REPEAT_MS = 10 * 60_000L

    fun key(j: JobBrief): String = j.provider + "|" + j.balanceAt

    /** Reads the heartbeat reply. Null when the reply carries no job list at all (an older server, or an error): the app then changes nothing. */
    fun parseBrief(text: String?): List<JobBrief>? = try {
        if (text.isNullOrBlank()) null
        else {
            val o = JSONObject(text)
            val a = o.optJSONArray("jobs")
            if (!o.optBoolean("success", false) || a == null) null
            else (0 until a.length()).mapNotNull { i ->
                val j = a.optJSONObject(i) ?: return@mapNotNull null
                val provider = j.optString("provider")
                if (provider.isBlank()) null
                else JobBrief(
                    provider = provider,
                    agent = j.optString("agent", ""),
                    urgency = j.optString("urgency", "normal").let { if (it == "urgent" || it == "critical") it else "normal" },
                    balance = j.optDouble("balance", 0.0),
                    balanceAt = j.optString("balance_at", ""),
                )
            }
        }
    } catch (e: Exception) {
        null
    }

    class Decision(val ring: List<JobBrief>, val state: Map<String, Long>)

    /** [lastRang] is when each open job last rang (milliseconds). The returned state only holds jobs that are still open. */
    fun decide(jobs: List<JobBrief>, lastRang: Map<String, Long>, now: Long): Decision {
        val ring = ArrayList<JobBrief>()
        val state = LinkedHashMap<String, Long>()
        for (j in jobs) {
            val k = key(j)
            val last = lastRang[k]
            if (last == null || now - last >= REPEAT_MS) {
                ring.add(j)
                state[k] = now
            } else {
                state[k] = last
            }
        }
        return Decision(ring, state)
    }

    fun encode(state: Map<String, Long>): String {
        val o = JSONObject()
        state.forEach { (k, v) -> o.put(k, v) }
        return o.toString()
    }

    fun decode(text: String?): Map<String, Long> = try {
        if (text.isNullOrBlank()) emptyMap()
        else {
            val o = JSONObject(text)
            val m = LinkedHashMap<String, Long>()
            val it = o.keys()
            while (it.hasNext()) {
                val k = it.next()
                m[k] = o.optLong(k, 0L)
            }
            m
        }
    } catch (e: Exception) {
        emptyMap()
    }

    private fun rank(u: String) = when (u) { "critical" -> 2; "urgent" -> 1; else -> 0 }

    /** The most urgent level among the jobs: "critical", "urgent" or "normal". */
    fun topUrgency(jobs: List<JobBrief>): String = jobs.maxByOrNull { rank(it.urgency) }?.urgency ?: "normal"

    /** One line per job for the notification: "Karim · bKash · Tk 12,000.00". */
    fun lines(jobs: List<JobBrief>): List<String> = jobs.map {
        (if (it.agent.isBlank()) "" else it.agent + " · ") + EarningsFormat.provider(it.provider) + " · " + EarningsFormat.money(it.balance)
    }
}

/** Rings the phone and shows a notification for jobs. Called with every heartbeat reply, so it works with the app closed. */
object JobAlarm {
    private const val CHANNEL = "jobs"
    private const val NOTIF_ID = 2
    private const val SOUND_MS = 5_000L

    @Volatile private var current: Ringtone? = null

    /** [jobs] is the full list of this phone's open jobs right now. Rings for the new ones, keeps the notification in step. */
    fun onJobs(ctx: Context, jobs: List<JobBrief>) {
        val s = AppSettings(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        val decision = JobAlertPolicy.decide(jobs, JobAlertPolicy.decode(s.jobAlertState), System.currentTimeMillis())
        s.jobAlertState = JobAlertPolicy.encode(decision.state)
        if (jobs.isEmpty()) {
            try { nm.cancel(NOTIF_ID) } catch (e: Exception) { }
            return
        }
        if (decision.ring.isEmpty()) return
        notify(ctx, nm, jobs)
        if (s.jobSound) ring(ctx)
    }

    private fun notify(ctx: Context, nm: NotificationManager, jobs: List<JobBrief>) {
        try {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Jobs", NotificationManager.IMPORTANCE_HIGH).apply {
                    setSound(null, null) // the sound is played by ring(), for exactly five seconds
                    enableVibration(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
            val open = PendingIntent.getActivity(
                ctx, 2, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val lines = JobAlertPolicy.lines(jobs)
            val top = JobAlertPolicy.topUrgency(jobs)
            val title = "কাজ করুন এখনই" + when (top) { "critical" -> " · CRITICAL"; "urgent" -> " · URGENT"; else -> "" }
            val n = Notification.Builder(ctx, CHANNEL)
                .setContentTitle(title)
                .setContentText(lines.first() + if (lines.size > 1) " (+${lines.size - 1} more)" else "")
                .setStyle(Notification.BigTextStyle().bigText(lines.joinToString("\n")))
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(open)
                .setCategory(Notification.CATEGORY_ALARM)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .build()
            nm.notify(NOTIF_ID, n)
        } catch (e: Exception) {
            // No permission to show notifications: the sound and the job inside the app still work.
        }
    }

    /** Alarm sound for five seconds, with vibration. Follows the phone's alarm volume. */
    fun ring(ctx: Context) {
        try {
            val app = ctx.applicationContext
            try { current?.stop() } catch (e: Exception) { }
            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val r = RingtoneManager.getRingtone(app, uri) ?: return
            r.audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (Build.VERSION.SDK_INT >= 28) r.isLooping = true // older phones play the alarm tone once
            current = r
            r.play()
            Handler(Looper.getMainLooper()).postDelayed({
                try { r.stop() } catch (e: Exception) { }
                if (current === r) current = null
            }, SOUND_MS)
        } catch (e: Exception) {
            // A phone with no alarm sound simply stays silent; the notification still shows.
        }
        try {
            val v = ctx.getSystemService(Vibrator::class.java)
            // 0.6 s on, 0.4 s off, five times = five seconds.
            v?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 400, 600, 400, 600, 400, 600, 400, 600), -1))
        } catch (e: Exception) {
        }
    }
}

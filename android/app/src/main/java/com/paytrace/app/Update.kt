package com.paytrace.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** What the small "latest.json" file next to the app download says about the newest build. */
data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val apkUrl: String,
    val sha256: String,
    val size: Long,
    val notes: String,
)

/** The rules for in-app updates, with no phone code in them so they can be tested. Anything that does not look exactly right
 *  is ignored: a broken or tampered file never offers an update. Android itself still refuses an app that is not signed
 *  with the same key as the one installed, so a swapped download could not be installed anyway. */
object UpdateLogic {
    /** Fixed address of the newest-version file (the download bucket's own domain). Only https. */
    const val LATEST_URL = "https://app.xn--bnq875cj52amsb.click/latest.json"
    const val CHECK_EVERY_MS = 6L * 60 * 60 * 1000
    const val MAX_APK_BYTES = 100L * 1024 * 1024
    private val FILE = Regex("^paytrace-[0-9]{1,6}\\.apk$")
    private val HEX64 = Regex("^[0-9a-f]{64}$")

    /** Reads latest.json. The download must sit in the same folder as latest.json and be named after its own version. */
    fun parse(json: String, latestUrl: String = LATEST_URL): UpdateInfo? {
        if (!latestUrl.startsWith("https://")) return null
        return try {
            val o = JSONObject(json)
            val code = o.getInt("version_code")
            val file = o.getString("apk")
            val sha = o.getString("sha256").lowercase()
            val size = o.getLong("size")
            if (code < 1 || !FILE.matches(file) || file != "paytrace-$code.apk") return null
            if (!HEX64.matches(sha) || size < 1 || size > MAX_APK_BYTES) return null
            val base = latestUrl.substringBeforeLast('/') + "/"
            UpdateInfo(code, "1.0.$code", base + file, sha, size, o.optString("notes", "").replace(Regex("[\\u0000-\\u001f]"), " ").trim().take(300))
        } catch (e: Exception) {
            null
        }
    }

    fun isNewer(info: UpdateInfo, installedCode: Int): Boolean = info.versionCode > installedCode

    /** Check at most every 6 hours on its own; "Check now" can force it. A clock that went backwards counts as due. */
    fun dueForCheck(lastCheckMs: Long, now: Long, force: Boolean = false): Boolean =
        force || lastCheckMs <= 0L || now < lastCheckMs || now - lastCheckMs >= CHECK_EVERY_MS

    /** Lower-case hex of a SHA-256 digest. */
    fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}

/** The network and install side of updates. Call everything here off the main thread except [installIntent] and [permissionIntent]. */
object Updater {
    private const val DIR = "updates"

    fun installedCode(ctx: Context): Int = try {
        PackageInfoCompat.getLongVersionCode(ctx.packageManager.getPackageInfo(ctx.packageName, 0)).toInt()
    } catch (e: Exception) {
        0
    }

    /** Asks the download address for the newest version. null = could not reach it, or the file was not valid. */
    fun fetchLatest(): UpdateInfo? {
        return try {
            val c = URL(UpdateLogic.LATEST_URL).openConnection() as HttpURLConnection
            c.connectTimeout = 10_000
            c.readTimeout = 10_000
            c.instanceFollowRedirects = false
            c.setRequestProperty("Cache-Control", "no-cache")
            try {
                if (c.responseCode != 200) return null
                val text = c.inputStream.use { it.readBytes() }
                if (text.size > 4000) return null
                UpdateLogic.parse(String(text, Charsets.UTF_8))
            } finally {
                c.disconnect()
            }
        } catch (e: Exception) {
            null
        }
    }

    /** Looks for a newer version if it is time (or [force]), remembers the answer, and returns the newest version known (null = none known). */
    fun check(ctx: Context, s: AppSettings, force: Boolean = false): UpdateInfo? {
        val now = System.currentTimeMillis()
        if (UpdateLogic.dueForCheck(s.updateCheckedAt, now, force)) {
            val latest = fetchLatest()
            if (latest != null) {
                s.updateJson = latestJsonOf(latest)
                s.updateCheckedAt = now
            }
        }
        return available(ctx, s)
    }

    /** The remembered newest version, but only if it is newer than what is installed. */
    fun available(ctx: Context, s: AppSettings): UpdateInfo? {
        val info = if (s.updateJson.isBlank()) null else UpdateLogic.parse(s.updateJson)
        return if (info != null && UpdateLogic.isNewer(info, installedCode(ctx))) info else null
    }

    private fun latestJsonOf(i: UpdateInfo): String =
        JSONObject().put("version_code", i.versionCode).put("apk", "paytrace-${i.versionCode}.apk").put("sha256", i.sha256).put("size", i.size).put("notes", i.notes).toString()

    /** Downloads the file, checks its size and SHA-256, and returns it. null = failed (nothing half-finished is kept). */
    fun download(ctx: Context, info: UpdateInfo, onProgress: (Int) -> Unit): File? {
        val dir = File(ctx.cacheDir, DIR).apply { mkdirs() }
        // Only the file being fetched stays on the phone.
        dir.listFiles()?.forEach { if (it.name != "paytrace-${info.versionCode}.apk") it.delete() }
        val done = File(dir, "paytrace-${info.versionCode}.apk")
        val part = File(dir, "paytrace-${info.versionCode}.apk.part")
        return try {
            if (!info.apkUrl.startsWith("https://")) return null
            val c = URL(info.apkUrl).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000
            c.readTimeout = 30_000
            c.instanceFollowRedirects = false
            try {
                if (c.responseCode != 200) return null
                val digest = MessageDigest.getInstance("SHA-256")
                var total = 0L
                c.inputStream.use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(32 * 1024)
                        var last = -1
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            total += n
                            if (total > info.size) return@use // longer than promised: stop, the size check below fails
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            val pct = (total * 100 / info.size).toInt().coerceIn(0, 100)
                            if (pct != last) { last = pct; onProgress(pct) }
                        }
                    }
                }
                if (total != info.size || UpdateLogic.hex(digest.digest()) != info.sha256) {
                    part.delete()
                    return null
                }
            } finally {
                c.disconnect()
            }
            done.delete()
            if (!part.renameTo(done)) return null
            done
        } catch (e: Exception) {
            part.delete()
            null
        }
    }

    /** Android asks the person once to allow PayTrace to install apps. */
    fun needsPermission(ctx: Context): Boolean = !ctx.packageManager.canRequestPackageInstalls()

    fun permissionIntent(ctx: Context): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** Opens Android's own installer for the downloaded file; the person taps Install. */
    fun installIntent(ctx: Context, file: File): Intent {
        val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".updates", file)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}

/** One quiet notification the first time a newer version is found, so partners who rarely open the app still hear about it. */
object UpdateNotice {
    private const val CHANNEL = "updates"
    private const val NOTIF_ID = 4107

    fun onFound(ctx: Context, s: AppSettings, info: UpdateInfo) {
        if (s.updateNotifiedCode >= info.versionCode) return
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT))
            val open = PendingIntent.getActivity(
                ctx, 3, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = Notification.Builder(ctx, CHANNEL)
                .setContentTitle("PayTrace update available")
                .setContentText("Version ${info.versionName} is ready. Open the app and tap Update now.")
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            nm.notify(NOTIF_ID, n)
            s.updateNotifiedCode = info.versionCode
        } catch (e: Exception) {
            // No permission to show notifications: the banner inside the app still appears.
        }
    }
}

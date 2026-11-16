package com.paytrace.app

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

/** What Android's installer answered, in plain words. Pure, so it can be tested. The numbers are Android's own
 *  PackageInstaller.STATUS_* values. */
object InstallWords {
    const val PENDING_USER_ACTION = -1
    const val SUCCESS = 0
    const val ABORTED = 3

    fun text(status: Int): String = when (status) {
        PENDING_USER_ACTION -> "Tap Install on the next screen."
        SUCCESS -> "Updated. PayTrace restarts by itself."
        ABORTED -> "The update was cancelled. Tap Update now to try again."
        2 -> "The phone blocked the update. Check that PayTrace may install apps, then try again."
        4 -> "The downloaded file was not accepted. Tap Update now to download it again."
        5 -> "Android refused the update: it does not match the PayTrace already on this phone."
        6 -> "Not enough free space on the phone. Free some space and try again."
        7 -> "This phone's Android version cannot install this update."
        8 -> "The update took too long. Tap Update now to try again."
        else -> "The update did not install. Tap Update now to try again."
    }
}

/**
 * Installs an update the way app stores do (Android's PackageInstaller session), instead of handing Android the file to
 * open. WHY: since Android 13, an app installed by opening a downloaded file is marked "restricted", which blocks its
 * Accessibility switch until "Allow restricted settings" (or adb) unlocks it again, and every update installed that way
 * marked PayTrace restricted again. A session install that says where the app came from as "other" (not "a downloaded
 * file") is not marked, so an unlock done once should survive later updates. The person still taps Install: an app
 * first installed from a file is not allowed to update itself silently. Android still refuses an APK signed with
 * another key, and the file was already checked against its SHA-256 by [Updater.download].
 */
object SelfInstall {
    private const val ACTION = "com.paytrace.app.INSTALL_RESULT"

    private val _status = MutableStateFlow("")
    /** The newest answer from Android's installer, shown under the Update now button. */
    val status: StateFlow<String> = _status

    internal fun say(text: String) {
        _status.value = text
    }

    /** Starts the install. Returns false if no session could even be made; the caller then opens the file the old way. */
    fun start(ctx: Context, file: File): Boolean {
        val installer = ctx.packageManager.packageInstaller
        var sessionId = -1
        return try {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            params.setAppPackageName(ctx.packageName)
            params.setSize(file.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // "Other", not "a downloaded file": only the two file sources are restricted by Android.
                params.setPackageSource(PackageInstaller.PACKAGE_SOURCE_OTHER)
            }
            sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                file.inputStream().use { input ->
                    session.openWrite("paytrace.apk", 0, file.length()).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                val reply = Intent(ACTION).setPackage(ctx.packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                val pi = PendingIntent.getBroadcast(ctx, sessionId, reply, flags)
                say("Getting the update ready…")
                session.commit(pi.intentSender)
            }
            true
        } catch (e: Exception) {
            if (sessionId >= 0) try { installer.abandonSession(sessionId) } catch (_: Exception) {}
            false
        }
    }
}

/** Android's installer reports here. "Needs the person's OK" opens Android's Install screen. */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            if (confirm != null) {
                try {
                    ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    SelfInstall.say(InstallWords.text(status))
                } catch (e: Exception) {
                    SelfInstall.say("Android did not show the Install screen. Open PayTrace and tap Update now again.")
                }
                return
            }
        }
        SelfInstall.say(InstallWords.text(status))
    }
}

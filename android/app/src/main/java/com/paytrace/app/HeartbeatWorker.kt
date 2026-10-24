package com.paytrace.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Every ~15 minutes (Android's shortest schedule for background work): checks the SMS inbox for payment messages
 *  that were missed, and sends a heartbeat. This is the safety net behind [MonitorService], which sends a heartbeat
 *  every 30 seconds while it is running; if Android ever stops the service, this still keeps the phone reporting. */
class HeartbeatWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        // First, pick up anything the live listener missed (phone off, app frozen). This needs no internet and
        // no approval: the messages are kept on the phone and sent as soon as the phone is allowed to.
        try {
            InboxScanner.run(applicationContext)
        } catch (e: Exception) {
            // Never let the safety net stop the heartbeat.
        }
        beat(applicationContext)
        // If Android stopped the always-on service, try to bring it back. It may refuse from the background; that is fine.
        MonitorService.start(applicationContext)
        return Result.success()
    }

    companion object {
        /** One heartbeat to the server. Does nothing until this phone has asked to join; a failure is fine, the next one is soon. */
        fun beat(ctx: Context) {
            val s = AppSettings(ctx)
            // Not asked to join yet (or removed): the app's own screen handles pairing.
            val waiting = s.deviceStatus == "pending" || s.deviceStatus == "approved"
            if (s.serverUrl.isBlank() || !(waiting || s.secret.isNotBlank())) return
            val before = s.deviceStatus
            val reply = Sender.send(s, Sender.heartbeat(ctx, s))
            // The reply lists this phone's open jobs: ring and show a notification for a new one, even with the app closed.
            try { JobAlertPolicy.parseBrief(reply.body)?.let { JobAlarm.onJobs(ctx, it) } } catch (e: Exception) { }
            // The moment the owner approves this phone, send whatever was waiting. Not on every heartbeat:
            // that would queue the same messages again and again.
            if (before != "approved" && s.deviceStatus == "approved") SendWorker.resumePending(ctx)
        }

        private const val PERIODIC = "heartbeat"
        private const val ONCE = "heartbeat-now"

        /** Safe to call as often as you like: an existing schedule is kept, not restarted. */
        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx.applicationContext)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** One heartbeat right away, e.g. when the app is opened. */
        fun now(ctx: Context) {
            val req = OneTimeWorkRequestBuilder<HeartbeatWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx.applicationContext)
                .enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }
    }
}

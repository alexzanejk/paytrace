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

/** Tells the server "this phone is alive" every ~15 minutes, so a dead phone is noticed within the hour
 *  instead of when a customer complains. It also learns when the owner approves the phone, so the app
 *  connects by itself without having to be opened. */
class HeartbeatWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val s = AppSettings(applicationContext)
        // Not asked to join yet (or removed): the app's own screen handles pairing.
        val waiting = s.deviceStatus == "pending" || s.deviceStatus == "approved"
        if (s.serverUrl.isBlank() || !(waiting || s.secret.isNotBlank())) return Result.success()

        // A failed heartbeat is fine: the next one is only 15 minutes away, and the server notices the silence.
        val before = s.deviceStatus
        Sender.send(s, Sender.heartbeat(applicationContext, s))
        // The moment the owner approves this phone, send whatever was waiting. Not on every heartbeat:
        // that would queue the same messages again and again.
        if (before != "approved" && s.deviceStatus == "approved") SendWorker.resumePending(applicationContext)
        return Result.success()
    }

    companion object {
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

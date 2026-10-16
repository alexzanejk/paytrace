package com.paytrace.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** Sends one stored SMS to the server. On failure it schedules the next try after the chosen interval,
 *  up to the chosen number of retries, then marks the message FAILED. */
class SendWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    override fun doWork(): Result {
        val id = inputData.getLong("id", -1L)
        if (id < 0) return Result.success()
        val db = Db.get(applicationContext)
        val row = db.get(id) ?: return Result.success()
        if (row.status != "PENDING") return Result.success()

        val s = AppSettings(applicationContext)
        val res = Sender.send(s, Sender.payload(s, row))
        val attempts = row.attempts + 1
        when {
            res.ok -> db.mark(id, "SENT", attempts, null)
            // Phone not approved yet: keep the message and try again later without using up its retries.
            res.deviceStatus == "pending" -> {
                db.mark(id, "PENDING", row.attempts, "Waiting for this phone to be approved in the dashboard")
                enqueue(applicationContext, id, s.retryMinutes.toLong())
            }
            attempts > s.maxRetries -> db.mark(id, "FAILED", attempts, res.error)
            else -> {
                db.mark(id, "PENDING", attempts, res.error)
                enqueue(applicationContext, id, s.retryMinutes.toLong())
            }
        }
        return Result.success()
    }

    companion object {
        fun enqueue(ctx: Context, id: Long, delayMinutes: Long) {
            val req = OneTimeWorkRequestBuilder<SendWorker>()
                .setInputData(workDataOf("id" to id))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(delayMinutes, TimeUnit.MINUTES)
                .addTag("send")
                .build()
            // One scheduled attempt per message: asking again (for example when the internet returns) replaces a
            // waiting delayed attempt with an immediate one instead of piling up copies.
            WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork("send-$id", ExistingWorkPolicy.REPLACE, req)
        }

        /** After a restart or app update, make sure nothing is left waiting without a scheduled attempt. */
        fun resumePending(ctx: Context) {
            for (id in Db.get(ctx).pendingIds()) enqueue(ctx, id, 0)
        }
    }
}

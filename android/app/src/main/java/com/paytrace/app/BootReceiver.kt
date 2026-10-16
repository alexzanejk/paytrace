package com.paytrace.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a phone restart or an app update: start watching again and finish anything that was still waiting to send. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        MonitorService.start(context) // always on: it is also what tells the dashboard this phone is online
        SendWorker.resumePending(context)
        HeartbeatWorker.schedule(context)
        HeartbeatWorker.now(context) // includes the inbox catch-up, so a restart recovers what arrived while it was off
    }
}

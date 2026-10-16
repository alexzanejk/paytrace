package com.paytrace.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a phone restart or an app update: start watching again and finish anything that was still waiting to send. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (AppSettings(context).monitoring) MonitorService.start(context)
        SendWorker.resumePending(context)
    }
}

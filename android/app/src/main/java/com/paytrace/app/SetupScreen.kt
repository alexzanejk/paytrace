package com.paytrace.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

fun openAppDetails(ctx: Context) {
    ctx.startActivity(
        Intent(AndroidSettings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}

/** The phone brand's own autostart page if this phone has one, otherwise PayTrace's normal settings page. */
fun openAutostartPage(ctx: Context) {
    if (!OemSettings.open(ctx)) openAppDetails(ctx)
}

private fun openNotificationSettings(ctx: Context) {
    ctx.startActivity(
        Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(AndroidSettings.EXTRA_APP_PACKAGE, ctx.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}

private fun askBatteryExemption(ctx: Context) {
    try {
        ctx.startActivity(
            Intent(AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (e: Exception) {
        try {
            ctx.startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e2: Exception) {
            openAppDetails(ctx)
        }
    }
}

/** Shown instead of the app until every permission and setting PayTrace needs is in place. */
@Composable
fun SetupScreen(settings: AppSettings, missing: List<Setup.Req>, onAutostartConfirmed: () -> Unit) {
    val ctx = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    // The first time, show Android's own questions straight away instead of waiting for a tap.
    LaunchedEffect(Unit) {
        val ask = ArrayList<String>()
        if (Setup.Req.SMS_RECEIVE in missing && !settings.wasAsked(Manifest.permission.RECEIVE_SMS)) ask.add(Manifest.permission.RECEIVE_SMS)
        if (Setup.Req.SMS_READ in missing && !settings.wasAsked(Manifest.permission.READ_SMS)) ask.add(Manifest.permission.READ_SMS)
        if (Build.VERSION.SDK_INT >= 33 && Setup.Req.NOTIFICATIONS in missing && !settings.wasAsked(Manifest.permission.POST_NOTIFICATIONS)) {
            ask.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (ask.isNotEmpty()) {
            ask.forEach { settings.markAsked(it) }
            launcher.launch(ask.toTypedArray())
        }
    }

    /** A runtime permission: the system question once, then the phone's app settings (Android will not ask twice). */
    fun askRuntime(permission: String) {
        if (settings.wasAsked(permission)) {
            openAppDetails(ctx)
        } else {
            settings.markAsked(permission)
            launcher.launch(arrayOf(permission))
        }
    }

    Column(
        Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Finish setting up PayTrace", style = MaterialTheme.typography.headlineSmall)
        Text(
            "PayTrace needs every item below so it can catch payments without a break and so the dashboard knows this phone is online. " +
                "The app stays on this page until all of them are done. Each one turns green when you come back from the phone's settings.",
        )

        Item(
            title = "Receive SMS",
            why = "Needed to see bKash, Nagad, Rocket and Upay payment messages.",
            done = Setup.Req.SMS_RECEIVE !in missing,
            actions = listOf("Allow" to { askRuntime(Manifest.permission.RECEIVE_SMS) }),
        )

        Item(
            title = "Read SMS inbox",
            why = "Needed to recover a payment message that arrived while the phone was off.",
            done = Setup.Req.SMS_READ !in missing,
            actions = listOf("Allow" to { askRuntime(Manifest.permission.READ_SMS) }),
        )

        Item(
            title = "Notifications",
            why = "PayTrace shows one quiet notice while it runs. Android is much less likely to stop an app that has it.",
            done = Setup.Req.NOTIFICATIONS !in missing,
            actions = listOf(
                "Allow" to {
                    if (Build.VERSION.SDK_INT >= 33 && !settings.wasAsked(Manifest.permission.POST_NOTIFICATIONS)) {
                        askRuntime(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        openNotificationSettings(ctx)
                    }
                },
            ),
        )

        Item(
            title = "Run in the background without limits",
            why = "Stops the battery saver from putting PayTrace to sleep, which would make this phone go offline. Choose \"Allow\" when Android asks.",
            done = Setup.Req.BATTERY !in missing,
            actions = listOf("Allow" to { askBatteryExemption(ctx) }),
        )

        if (Setup.needsAutostartConfirm(Build.MANUFACTURER) || Setup.Req.AUTOSTART in missing) {
            Item(
                title = "Allow auto-start (" + Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + ")",
                why = "This phone brand has its own power manager that stops apps when the screen is off, even after the normal battery setting is allowed. " +
                    "Do ALL of these, then tap the second button. Android cannot check them for us, so please do not tap it until they are done:\n" +
                    Setup.brandSteps(Build.MANUFACTURER).mapIndexed { i, step -> "${i + 1}. $step" }.joinToString("\n") +
                    "\n(Wording differs a little between models.)",
                done = Setup.Req.AUTOSTART !in missing,
                actions = listOf(
                    "Open the autostart page" to { openAutostartPage(ctx) },
                    "Open PayTrace's app settings" to { openAppDetails(ctx) },
                    "I have done all of these" to onAutostartConfirmed,
                ),
            )
        }
    }
}

@Composable
private fun Item(
    title: String,
    why: String,
    done: Boolean,
    actions: List<Pair<String, () -> Unit>>,
) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (done) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer,
        ),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text((if (done) "✓  " else "✗  ") + title, style = MaterialTheme.typography.titleMedium)
            Text(why, style = MaterialTheme.typography.bodySmall)
            if (!done) {
                actions.forEach { (label, run) -> Button(onClick = run) { Text(label) } }
            }
        }
    }
}

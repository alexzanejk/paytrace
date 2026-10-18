package com.paytrace.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    companion object {
        /** A notification tap asks to open this conversation (the sender's address). */
        const val EXTRA_OPEN_THREAD = "open_thread"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(EXTRA_OPEN_THREAD)?.let { LaunchRequest.address = it }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.getStringExtra(EXTRA_OPEN_THREAD)?.let { LaunchRequest.address = it }
        MonitorService.start(this) // always on: it also tells the dashboard this phone is online
        SendWorker.resumePending(this)
        HeartbeatWorker.schedule(this)
        HeartbeatWorker.now(this)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Surface(Modifier.fillMaxSize()) { App() }
            }
        }
    }
}

@Composable
fun App() {
    val ctx = LocalContext.current
    val settings = remember { AppSettings(ctx) }
    var tab by remember { mutableIntStateOf(0) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(2000)
            tick++
        }
    }

    // The phone is a plain forwarder: what to watch and what to show is managed in the web dashboard. Undo any old
    // on/off choices made here in earlier versions so nothing stays switched off with no way to see it.
    LaunchedEffect(Unit) {
        settings.monitoring = true
        Providers.ALL.forEach { settings.setProviderEnabled(it, true) }
    }

    // Until every permission and setting PayTrace needs is in place, nothing else can be used. `tick` re-checks every
    // couple of seconds, so coming back from the phone's settings unlocks the app by itself.
    var confirmed by remember { mutableStateOf(settings.autostartConfirmed) }
    val missing = remember(tick, confirmed) { Setup.missing(ctx, settings) }
    if (missing.isNotEmpty()) {
        SetupScreen(settings, missing, onAutostartConfirmed = { settings.autostartConfirmed = true; confirmed = true })
        return
    }

    // Once, right after setup: ask whether PayTrace should become the phone's SMS app (recommended for payment phones).
    var askSmsApp by remember { mutableStateOf(!settings.defaultSmsPrompted && !DefaultSms.isDefault(ctx)) }
    val smsAppLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { }
    if (askSmsApp) {
        AlertDialog(
            onDismissRequest = { },
            title = { Text("Make PayTrace this phone's SMS app?") },
            text = {
                Text(
                    "Recommended for a phone used for payments. Phone brands almost never stop the messaging app, so PayTrace " +
                        "stays alive with the screen off. You can still read and send text messages here. Picture messages are not " +
                        "supported. You can switch back any time.",
                )
            },
            confirmButton = {
                Button(onClick = {
                    settings.defaultSmsPrompted = true
                    askSmsApp = false
                    val i = DefaultSms.requestIntent(ctx)
                    if (i != null) smsAppLauncher.launch(i) else ctx.startActivity(DefaultSms.settingsIntent())
                }) { Text("Yes, make it the SMS app") }
            },
            dismissButton = {
                TextButton(onClick = { settings.defaultSmsPrompted = true; askSmsApp = false }) { Text("Not now") }
            },
        )
    }

    // A tap on a message notification jumps to that conversation.
    val launchAddress = LaunchRequest.address
    LaunchedEffect(launchAddress) { if (launchAddress != null) tab = 1 }

    var unread by remember { mutableIntStateOf(0) }
    LaunchedEffect(tick) { unread = withContext(Dispatchers.IO) { if (SmsStore.canRead(ctx)) SmsStore.unreadTotal(ctx) else 0 } }

    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        Text("PayTrace", Modifier.padding(start = 20.dp, top = 14.dp, bottom = 6.dp), style = MaterialTheme.typography.titleLarge)
        TabRow(selectedTabIndex = tab) {
            listOf("Home", if (unread > 0) "Messages ($unread)" else "Messages", "Settings").forEachIndexed { i, title ->
                Tab(selected = tab == i, onClick = { tab = i }, text = { Text(title) })
            }
        }
        when (tab) {
            0 -> Home(settings, tick)
            1 -> MessagesScreen(tick, onOpenDashboard = { tab = 0 })
            else -> SettingsScreen(settings, tick)
        }
    }
}

@Composable
private fun Warning(text: String) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) { Text(text, Modifier.padding(14.dp), color = MaterialTheme.colorScheme.onErrorContainer) }
}

/** One calm status screen: is this phone connected and watching, and anything that needs fixing. No numbers or switches. */
@Composable
fun Home(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    val configured = remember(tick) { settings.ready }
    val smsOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    val readOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
    val healthy = configured && smsOk && readOk

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Card(
            Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (healthy) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.secondaryContainer,
            ),
        ) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(if (healthy) "●" else "○", style = MaterialTheme.typography.displayMedium)
                Text(
                    when {
                        healthy -> "Running"
                        !configured -> "Not connected yet"
                        else -> "Needs attention"
                    },
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    if (healthy) "Payment messages are being sent to your dashboard." else "See below.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(settings.deviceName, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (!smsOk) Warning("SMS permission is off. Open the phone's app settings for PayTrace and allow SMS, or no payment can be detected.")
        if (smsOk && !readOk) Warning("Reading old SMS is off. Allow it in the phone's app settings for PayTrace, or a payment message that arrives while the phone is off cannot be recovered.")
        if (!configured) PairCard(settings)
        SmsAppBanner(tick)
        Text(
            "Leave this phone on, charged and connected to the internet. Totals, logs and settings are in the web dashboard.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
fun SettingsScreen(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(settings.serverUrl) }
    var secret by remember { mutableStateOf(settings.secret) }
    var msg by remember { mutableStateOf("") }
    var advanced by remember { mutableStateOf(false) }
    var strong by remember { mutableStateOf(settings.strongAlarm) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            when (settings.deviceStatus) {
                "approved" -> "Connected to your dashboard. Code " + settings.pairCode
                "pending" -> "Waiting for approval in the dashboard. Code " + settings.pairCode
                "revoked" -> "Removed in the dashboard. Open Home to ask again."
                else -> "Not connected yet. Open Home to connect."
            },
        )

        SmsAppModeCard(tick)

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Extra-strong keep-alive", style = MaterialTheme.typography.titleSmall)
                Text(
                    "A backup alarm every 5 minutes restarts PayTrace if the phone stops it. Shows a small alarm icon. Recommended.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Switch(checked = strong, onCheckedChange = {
                strong = it
                settings.strongAlarm = it
                Keepalive.schedule(ctx)
            })
        }

        val stopped = remember(tick) { settings.stoppedCount }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Does this phone keep going offline?", style = MaterialTheme.typography.titleSmall)
                if (stopped > 0) {
                    Text(
                        "The phone has stopped PayTrace $stopped time${if (stopped == 1) "" else "s"} (last time for ${settings.lastGapMin} minutes). " +
                            "Its battery manager is closing the app when the screen is off.",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text("Check these in the phone's Settings (wording differs a little by model):", style = MaterialTheme.typography.bodySmall)
                Setup.brandSteps(Build.MANUFACTURER).forEachIndexed { i, step ->
                    Text("${i + 1}. $step", style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { openAutostartPage(ctx) }) { Text("Autostart page") }
                    OutlinedButton(onClick = { openAppDetails(ctx) }) { Text("App settings") }
                }
                OutlinedButton(onClick = {
                    ctx.startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                }) { Text("Allow running in background (battery)") }
            }
        }

        TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Hide advanced" else "Advanced") }
        if (advanced) {
            OutlinedTextField(
                value = url, onValueChange = { url = it }, label = { Text("Server URL") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            )
            if (url.trim().startsWith("http://")) {
                Text("This address is not encrypted (http). Use https:// so your payment data cannot be read on the way.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            OutlinedTextField(
                value = secret, onValueChange = { secret = it }, label = { Text("Shared secret key (leave empty)") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(),
            )
            Button(onClick = {
                settings.serverUrl = url
                settings.secret = secret.trim()
                msg = "Saved."
            }) { Text("Save") }
            if (msg.isNotEmpty()) Text(msg)
        }
    }
}

/** A reminder at the top of the first screen while PayTrace is not the phone's SMS app. */
@Composable
private fun SmsAppBanner(tick: Int) {
    val ctx = LocalContext.current
    val isDefault = remember(tick) { DefaultSms.isDefault(ctx) }
    if (isDefault) return
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { }
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Make PayTrace this phone's SMS app so the phone keeps it running with the screen off.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                val i = DefaultSms.requestIntent(ctx)
                if (i != null) launcher.launch(i) else ctx.startActivity(DefaultSms.settingsIntent())
            }) { Text("Make PayTrace the SMS app") }
        }
    }
}

/** Optional: make PayTrace the phone's messaging app, which phone brands almost never stop. */
@Composable
private fun SmsAppModeCard(tick: Int) {
    val ctx = LocalContext.current
    val isDefault = remember(tick) { DefaultSms.isDefault(ctx) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (isDefault) "SMS app mode: on" else "SMS app mode", style = MaterialTheme.typography.titleSmall)
            Text(
                if (isDefault) "PayTrace is this phone's messaging app, so the phone almost never stops it. Picture messages are not supported."
                else "Recommended for a payment phone: the phone almost never stops its messaging app. Picture messages are not supported.",
                style = MaterialTheme.typography.bodySmall,
            )
            if (isDefault) {
                OutlinedButton(onClick = { ctx.startActivity(DefaultSms.settingsIntent()) }) { Text("Choose another messaging app") }
            } else {
                Button(onClick = {
                    val i = DefaultSms.requestIntent(ctx)
                    if (i != null) launcher.launch(i) else ctx.startActivity(DefaultSms.settingsIntent())
                }) { Text("Turn on SMS app mode") }
            }
        }
    }
}

/** Shown until this phone is approved. Nothing to type: the admin approves the code in the web dashboard. */
@Composable
private fun PairCard(settings: AppSettings) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf(settings.deviceStatus) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    fun check() {
        busy = true
        scope.launch {
            val r = withContext(Dispatchers.IO) {
                if (settings.deviceStatus == "unpaired" || settings.deviceStatus == "revoked") Sender.pair(settings)
                else Sender.test(settings)
            }
            busy = false
            status = settings.deviceStatus
            note = when {
                status == "approved" -> { SendWorker.resumePending(ctx); "Approved. This phone is now connected." }
                r.deviceStatus == null && !r.ok -> "Could not reach the server: " + (r.error ?: "unknown") + ". Check the internet and try again."
                status == "pending" -> "Not approved yet."
                else -> ""
            }
        }
    }
    // Ask to join automatically the first time, so the code is already waiting in the dashboard.
    LaunchedEffect(Unit) { if (status != "approved") check() }

    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Connect this phone", style = MaterialTheme.typography.titleMedium)
            if (status == "revoked") {
                Text("This phone was removed in the dashboard. Tap \"Ask again\" to request a new approval.")
            } else {
                Text("On a computer, open the PayTrace dashboard, go to Devices and tap Approve next to this code:")
                Text(settings.pairCode, style = MaterialTheme.typography.headlineMedium)
                Text(settings.deviceName, style = MaterialTheme.typography.bodySmall)
            }
            Button(enabled = !busy, onClick = {
                if (status == "revoked") settings.resetDeviceKey()
                check()
            }) { Text(if (busy) "Checking…" else if (status == "revoked") "Ask again" else "I approved it, check now") }
            if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.bodySmall)
        }
    }
}
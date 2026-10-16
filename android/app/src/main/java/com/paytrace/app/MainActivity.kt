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
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

private fun money(v: Double): String = String.format(Locale.US, "Tk %,.2f", v)
private fun timeText(ms: Long): String = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(Date(ms))

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

    // Until every permission and setting PayTrace needs is in place, nothing else can be used. `tick` re-checks every
    // couple of seconds, so coming back from the phone's settings unlocks the app by itself.
    var confirmed by remember { mutableStateOf(settings.autostartConfirmed) }
    val missing = remember(tick, confirmed) { Setup.missing(ctx, settings) }
    if (missing.isNotEmpty()) {
        SetupScreen(settings, missing, onAutostartConfirmed = { settings.autostartConfirmed = true; confirmed = true })
        return
    }

    Column(Modifier.fillMaxSize().systemBarsPadding()) {
        TabRow(selectedTabIndex = tab) {
            listOf("Dashboard", "Logs", "Settings").forEachIndexed { i, title ->
                Tab(selected = tab == i, onClick = { tab = i }, text = { Text(title) })
            }
        }
        when (tab) {
            0 -> Dashboard(settings, tick)
            1 -> Logs(tick)
            else -> SettingsScreen(settings)
        }
    }
}

@Composable
private fun Warning(text: String) {
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
    ) { Text(text, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer) }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium)
            Text(value, style = MaterialTheme.typography.headlineSmall)
        }
    }
}

@Composable
fun Dashboard(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    val stats = remember(tick) { Db.get(ctx).todayStats() }
    val configured = remember(tick) { settings.ready }
    val smsOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    val readOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED
    var on by remember { mutableStateOf(settings.monitoring) }

    LazyColumn(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Monitoring", style = MaterialTheme.typography.titleMedium)
                    Text(if (on) "Watching for payment SMS" else "Paused: payments are NOT being forwarded")
                }
                Switch(checked = on, onCheckedChange = {
                    on = it
                    settings.monitoring = it
                })
            }
        }
        item {
            val last = remember(tick) { settings.inboxCheckedAt }
            val recovered = remember(tick) { settings.recoveredTotal }
            Text(
                when {
                    !readOk -> "Missed-message recovery is off."
                    last == null -> "Missed-message recovery: not run yet."
                    recovered == 0 -> "Inbox last checked " + timeText(last) + ". Nothing was missed."
                    else -> "Inbox last checked " + timeText(last) + ". Recovered " + recovered + " missed message" + (if (recovered == 1) "" else "s") + "."
                },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (smsOk && !readOk) item { Warning("Reading old SMS is off. Allow it in the phone's app settings for PayTrace, or a payment message that arrives while the phone is off cannot be recovered.") }
        if (!smsOk) item { Warning("SMS permission is off. Open the phone's app settings for PayTrace and allow SMS, or no payment can be detected.") }
        if (!configured) item { PairCard(settings) }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("Received today", money(stats.receivedTotal), Modifier.weight(1f))
                StatCard("Cash Out today", money(stats.cashOutTotal), Modifier.weight(1f))
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("Sent", stats.sent.toString(), Modifier.weight(1f))
                StatCard("Failed", stats.failed.toString(), Modifier.weight(1f))
                StatCard("Waiting", stats.pending.toString(), Modifier.weight(1f))
            }
        }
        item { Text("Providers", style = MaterialTheme.typography.titleMedium) }
        items(Providers.ALL) { p ->
            var en by remember(p) { mutableStateOf(settings.providerEnabled(p)) }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(Providers.LABEL[p] ?: p, Modifier.weight(1f))
                Switch(checked = en, onCheckedChange = {
                    en = it
                    settings.setProviderEnabled(p, it)
                })
            }
        }
        item {
            OutlinedButton(onClick = {
                ctx.startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }) { Text("Allow running in background (battery)") }
        }
        item { SmsAppModeCard(tick) }
        item {
            val stopped = remember(tick) { settings.stoppedCount }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
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
                        Button(onClick = { openAutostartPage(ctx) }) { Text("Open the autostart page") }
                        OutlinedButton(onClick = { openAppDetails(ctx) }) { Text("App settings") }
                    }
                }
            }
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
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (isDefault) "SMS app mode: ON" else "SMS app mode (optional)", style = MaterialTheme.typography.titleSmall)
            if (isDefault) {
                Text(
                    "PayTrace is this phone's messaging app, so Android delivers payment messages to it first and the phone's battery manager almost never stops it. " +
                        "Other messages (bank codes, friends) still arrive: they appear as notifications from PayTrace and in the phone's inbox, and you can read them in any other messaging app. " +
                        "PayTrace cannot send messages or receive picture messages.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { ctx.startActivity(DefaultSms.settingsIntent()) }) { Text("Choose another messaging app (Default apps)") }
            } else {
                Text(
                    "Recommended for a phone used only for payments. It makes this phone stop closing PayTrace when the screen is off. " +
                        "Trade-off: PayTrace replaces the phone's messaging app. Other messages still arrive (as notifications from PayTrace and in the inbox of any other messaging app), " +
                        "but you cannot send messages or receive picture messages from this phone. You can switch back any time.",
                    style = MaterialTheme.typography.bodySmall,
                )
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Logs(tick: Int) {
    val ctx = LocalContext.current
    val db = Db.get(ctx)
    var status by remember { mutableStateOf<String?>(null) }
    var prov by remember { mutableStateOf<String?>(null) }
    val rows = remember(tick, status, prov) { db.list(status, prov, 200) }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("PENDING", "SENT", "FAILED").forEach { s ->
                FilterChip(selected = status == s, onClick = { status = if (status == s) null else s }, label = { Text(s) })
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Providers.ALL.forEach { p ->
                FilterChip(selected = prov == p, onClick = { prov = if (prov == p) null else p }, label = { Text(Providers.LABEL[p] ?: p) })
            }
        }
        if (rows.isEmpty()) Text("No messages yet.", Modifier.padding(16.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(rows, key = { it.id }) { r -> LogItem(r) }
        }
    }
}

@Composable
private fun LogItem(r: LogRow) {
    val ctx = LocalContext.current
    var open by remember(r.id) { mutableStateOf(false) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Text(
                    (Providers.LABEL[r.provider] ?: r.provider) + (if (r.cashOut) " · Cash Out" else ""),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                )
                Text(r.status, style = MaterialTheme.typography.labelLarge)
            }
            Text((r.trxId ?: "no TrxID found") + "  ·  " + (r.amount?.let { money(it) } ?: "amount ?"))
            Text(timeText(r.createdAt) + "  ·  tries: " + r.attempts, style = MaterialTheme.typography.bodySmall)
            if (r.error != null) Text(r.error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            if (open) Text(r.body, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodySmall)
            Row {
                TextButton(onClick = { open = !open }) { Text(if (open) "Hide SMS" else "Show SMS") }
                if (r.status != "SENT") {
                    TextButton(onClick = {
                        Db.get(ctx).resetForRetry(r.id)
                        SendWorker.enqueue(ctx, r.id, 0)
                    }) { Text("Retry") }
                    TextButton(onClick = { Db.get(ctx).markSuccess(r.id) }) { Text("Mark success") }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(settings: AppSettings) {
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf(settings.serverUrl) }
    var secret by remember { mutableStateOf(settings.secret) }
    var method by remember { mutableStateOf(settings.method) }
    var fields by remember { mutableStateOf(settings.fields + AppSettings.LOCKED) }
    var retries by remember { mutableStateOf(settings.maxRetries.toString()) }
    var interval by remember { mutableStateOf(settings.retryMinutes.toString()) }
    var msg by remember { mutableStateOf("") }
    var testing by remember { mutableStateOf(false) }
    var advanced by remember { mutableStateOf(false) }

    fun save() {
        settings.serverUrl = url
        settings.secret = secret.trim()
        settings.method = method
        settings.fields = fields
        settings.maxRetries = retries.toIntOrNull()?.coerceIn(0, 20) ?: 3
        settings.retryMinutes = interval.toIntOrNull()?.coerceIn(1, 1440) ?: 15
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("This phone", style = MaterialTheme.typography.titleMedium)
        Text(
            when (settings.deviceStatus) {
                "approved" -> "Connected (approved in the dashboard). Code " + settings.pairCode
                "pending" -> "Waiting for approval in the dashboard. Code " + settings.pairCode
                "revoked" -> "Removed in the dashboard. Open the Dashboard tab to ask again."
                else -> "Not connected yet. Open the Dashboard tab to connect."
            } + if (settings.secret.isNotBlank()) "\nA shared secret key is set under Advanced and is used instead." else ""
        )

        TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Hide advanced" else "Advanced (normally not needed)") }
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
            Text("Request method", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = method == "POST", onClick = { method = "POST" })
                Text("POST (recommended)")
                RadioButton(selected = method == "GET", onClick = { method = "GET" })
                Text("GET")
            }
        }

        Text("Data to send", style = MaterialTheme.typography.titleMedium)
        AppSettings.FIELD_LABELS.forEach { (key, label) ->
            val locked = key in AppSettings.LOCKED
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = key in fields, enabled = !locked,
                    onCheckedChange = { fields = if (it) fields + key else fields - key },
                )
                Text(label)
            }
        }

        Text("If sending fails", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedTextField(
                value = retries, onValueChange = { retries = it.filter(Char::isDigit).take(2) },
                label = { Text("Retries") }, singleLine = true, modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            OutlinedTextField(
                value = interval, onValueChange = { interval = it.filter(Char::isDigit).take(4) },
                label = { Text("Minutes between tries") }, singleLine = true, modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { save(); msg = "Saved." }) { Text("Save") }
            OutlinedButton(enabled = !testing, onClick = {
                save()
                testing = true
                msg = "Testing…"
                scope.launch {
                    val r = withContext(Dispatchers.IO) { Sender.test(settings) }
                    testing = false
                    msg = if (r.ok) "Connection OK. Server accepted the test." else "Failed: " + (r.error ?: "unknown") + (r.body?.let { " " + it } ?: "")
                }
            }) { Text("Test connection") }
        }
        if (msg.isNotEmpty()) Text(msg)
    }
}

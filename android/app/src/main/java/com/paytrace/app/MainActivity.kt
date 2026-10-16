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
        if (AppSettings(this).monitoring) MonitorService.start(this)
        SendWorker.resumePending(this)
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Surface(Modifier.fillMaxSize()) { App() }
            }
        }
    }
}

private fun requiredPermissions(): Array<String> {
    val list = arrayListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
    if (Build.VERSION.SDK_INT >= 33) list.add(Manifest.permission.POST_NOTIFICATIONS)
    return list.toTypedArray()
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
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    LaunchedEffect(Unit) { permLauncher.launch(requiredPermissions()) }

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
    val configured = remember(tick) { settings.serverUrl.isNotBlank() && settings.secret.isNotBlank() }
    val smsOk = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
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
                    if (it) MonitorService.start(ctx) else MonitorService.stop(ctx)
                })
            }
        }
        if (!smsOk) item { Warning("SMS permission is off. Open the phone's app settings for PayTrace and allow SMS, or no payment can be detected.") }
        if (!configured) item { Warning("Open the Settings tab and enter your server URL and secret key.") }
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
        item {
            Text(
                "Tip: on Xiaomi, Oppo, Vivo, Realme and Samsung phones also set PayTrace to \"No restrictions\" / \"Autostart\" in the phone's app settings, or Android may stop it.",
                style = MaterialTheme.typography.bodySmall,
            )
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
        Text("Server", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = url, onValueChange = { url = it }, label = { Text("Server URL") },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        if (url.trim().startsWith("http://")) {
            Text("This address is not encrypted (http). Use https:// so your secret key and payment data cannot be read on the way.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(
            value = secret, onValueChange = { secret = it }, label = { Text("Secret key") },
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

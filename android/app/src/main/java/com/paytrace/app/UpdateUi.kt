package com.paytrace.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Downloads the new version, checks it, and opens Android's installer. The person taps Install there. */
@Composable
private fun UpdateActions(info: UpdateInfo) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var progress by remember { mutableIntStateOf(0) }
    var msg by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (msg.isNotBlank()) Text(msg, style = MaterialTheme.typography.bodySmall)
        Button(
            enabled = !busy,
            onClick = {
                scope.launch {
                    msg = ""
                    if (Updater.needsPermission(ctx)) {
                        msg = "Android needs your OK first. Allow PayTrace to install apps on the next screen, go back, then tap Update now again."
                        ctx.startActivity(Updater.permissionIntent(ctx))
                        return@launch
                    }
                    busy = true
                    progress = 0
                    val file = withContext(Dispatchers.IO) { Updater.download(ctx, info) { p -> progress = p } }
                    busy = false
                    if (file == null) {
                        msg = "The download did not work. Check the internet and try again."
                    } else {
                        msg = "Tap Install on the next screen."
                        ctx.startActivity(Updater.installIntent(ctx, file))
                    }
                }
            },
        ) { Text(if (busy) "Downloading… $progress%" else "Update now") }
    }
}

/** Shown at the top of every screen while a newer version of the app is available. */
@Composable
fun UpdateBanner(info: UpdateInfo) {
    Card(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Update available: version ${info.versionName}", style = MaterialTheme.typography.titleSmall)
            if (info.notes.isNotBlank()) Text(info.notes, style = MaterialTheme.typography.bodySmall)
            UpdateActions(info)
        }
    }
}

/** On the Settings tab: the installed version and a "Check for updates" button. */
@Composable
fun UpdateCard(settings: AppSettings, onChecked: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    val installed = remember { Updater.installedCode(ctx) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("App updates", style = MaterialTheme.typography.titleSmall)
            Text("This phone has version 1.0.$installed.", style = MaterialTheme.typography.bodyMedium)
            if (note.isNotBlank()) Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(
                enabled = !checking,
                onClick = {
                    scope.launch {
                        checking = true
                        note = ""
                        val before = settings.updateCheckedAt
                        val found = withContext(Dispatchers.IO) { Updater.check(ctx, settings, force = true) }
                        checking = false
                        note = when {
                            found != null -> "Version ${found.versionName} is available. Tap Update now at the top."
                            settings.updateCheckedAt > before -> "You have the newest version."
                            else -> "Could not check. Check the internet and try again."
                        }
                        onChecked()
                    }
                },
            ) { Text(if (checking) "Checking…" else "Check for updates") }
        }
    }
}

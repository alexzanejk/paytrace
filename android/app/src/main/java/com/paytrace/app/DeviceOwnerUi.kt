package com.paytrace.app

import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/** Settings card for the device-owner test (2026-11-02, owner's request; Xiaomi first, their choice).
 *
 *  It only looks and reports. The one thing it can change is giving the seat BACK, which is the point of having it
 *  in the same build as the receiver. [tick] refreshes it when the person returns from Android's own settings. */
@Composable
fun DeviceOwnerCard(tick: Int) {
    val ctx = LocalContext.current
    val clip = LocalClipboardManager.current
    val owner = remember(tick) { DeviceOwner.isOwner(ctx) }
    val could = remember(tick) { DeviceOwner.couldBeOwner(ctx) }
    val command = remember { DeviceOwner.adbCommand(ctx.packageName) }
    val xiaomi = remember { DeviceOwner.isXiaomi(Build.MANUFACTURER, Build.BRAND) }
    var confirm by remember { mutableStateOf(false) }
    var said by remember { mutableStateOf("") }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Let PayTrace own this phone (test)", style = MaterialTheme.typography.titleSmall)

            if (owner) {
                Text(
                    "✓ PayTrace is this phone's device owner.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(
                    "Nothing is being enforced: this build asks for no powers at all, so the phone behaves exactly as " +
                        "before. What it proves is that this phone's brand allows it. Tell the dashboard owner, and " +
                        "release it below when the test is done.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "While PayTrace is the device owner it cannot be uninstalled. Release it first.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Button(onClick = { confirm = true }) { Text("Release this phone") }
            } else {
                Text(
                    when (could) {
                        true -> "This phone says it could still be made a managed device."
                        false -> "This phone says NO for now — usually because an account is signed in " +
                            "(Settings → Accounts), or another app already holds the seat."
                        else -> "This phone did not answer whether it allows it."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    "What it would buy later, once agreed one power at a time: updates that install themselves with " +
                        "nobody tapping Install, the SMS and phone permissions granted without asking, the app " +
                        "impossible to remove, and the \"restricted settings\" block on Accessibility gone — the one " +
                        "that has to be undone by hand after every update.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "It would NOT fix the phone brand's own rules (Autostart, pop-up windows, background power). " +
                        "Those are not Android's and no policy reaches them.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Text("Run this once from a computer:", style = MaterialTheme.typography.bodyMedium)
                Text(
                    command,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        clip.setText(AnnotatedString(command))
                        said = "Command copied."
                    }) { Text("Copy command") }
                }

                Text("First, every one of these:", style = MaterialTheme.typography.bodyMedium)
                DeviceOwner.requirements.forEach {
                    Text("• " + it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                if (xiaomi) Text(
                    "⚠ " + DeviceOwner.XIAOMI_WARNING,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { open(ctx, Settings.ACTION_SYNC_SETTINGS) }) { Text("Accounts") }
                    OutlinedButton(onClick = { open(ctx, Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS) }) {
                        Text("Developer options")
                    }
                }
            }

            if (said.isNotBlank()) Text(said, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }

    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Release this phone?") },
        text = {
            Text(
                "PayTrace stops being the device owner and goes back to being an ordinary app. Nothing else on the " +
                    "phone changes, and nothing PayTrace does is lost. To become the owner again the command has to " +
                    "be run again, which needs the accounts removed again.",
            )
        },
        confirmButton = {
            TextButton(onClick = {
                confirm = false
                said = if (DeviceOwner.release(ctx)) "Released. PayTrace is an ordinary app again."
                else "This phone refused to release it. Tell the dashboard owner before doing anything else."
            }) { Text("Release") }
        },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Keep it") } },
    )
}

private fun open(ctx: android.content.Context, action: String) {
    try {
        ctx.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
        // Not every phone has every settings page; the person can reach both by hand.
    }
}

package com.paytrace.app

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Settings card for the dashboard-driven Nagad balance check. Everything is set up here, once per phone:
 *  Accessibility on, phone permission, which SIM, the PIN (kept encrypted on this phone only), and a switch.
 *  [tick] makes the ticks below refresh when the person comes back from Android's settings. */
@Composable
fun UssdCard(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    var allowed by remember { mutableStateOf(settings.ussdAllowed) }
    var slot by remember { mutableStateOf(settings.ussdSlot) }
    var pin by remember { mutableStateOf("") }
    var pinSaved by remember { mutableStateOf(UssdSetup.pinSaved(ctx)) }
    var running by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    // Read again every time the screen refreshes (tick changes), so the ticks follow what Android says.
    val accessibility = UssdSetup.accessibilityOn(ctx)
    val call = UssdSetup.callPermission(ctx)
    val last = remember(tick, running) { parseLast(settings.ussdLast) }
    val steps = remember(tick, running) { lastTrace(settings.ussdLast) }
    var details by remember { mutableStateOf(false) }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Nagad balance check from the dashboard", style = MaterialTheme.typography.titleSmall)
            Text(
                "When the owner asks, this phone opens the Nagad menu (*167#), types the PIN and reads the balance. It never sends money. Set it up once, in this order:",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text((if (accessibility) "✓ " else "1. ") + "Switch on PayTrace in Accessibility", style = MaterialTheme.typography.bodyMedium)
            if (!accessibility) {
                Text(
                    "Tap the button, find \"PayTrace Nagad balance check\" and switch it on. If Android says it is restricted: go to Settings, Apps, PayTrace, tap the three dots, then \"Allow restricted settings\", and try again.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }) { Text("Open Accessibility settings") }
            }

            Text((if (call) "✓ " else "2. ") + "Allow phone calls (needed to open *167#)", style = MaterialTheme.typography.bodyMedium)
            if (!call) OutlinedButton(onClick = { permission.launch(Manifest.permission.CALL_PHONE) }) { Text("Allow") }

            Text("3. Which SIM has Nagad?", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = slot == 0, onClick = { slot = 0; settings.ussdSlot = 0 }, label = { Text("SIM 1") })
                FilterChip(selected = slot == 1, onClick = { slot = 1; settings.ussdSlot = 1 }, label = { Text("SIM 2") })
            }
            Text(
                "If the phone never asks which SIM to use, set the Nagad SIM as the phone's default for calls.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text((if (pinSaved) "✓ " else "4. ") + "Nagad PIN" + if (pinSaved) " saved on this phone" else "", style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(
                value = pin,
                onValueChange = { v -> pin = v.filter { it.isDigit() }.take(8) },
                label = { Text(if (pinSaved) "New PIN (to replace the saved one)" else "Type the PIN here") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    enabled = pin.length >= 4,
                    onClick = { SecretStore(ctx.applicationContext, "ussd_pin").set(pin); pin = ""; pinSaved = true },
                ) { Text("Save PIN") }
                if (pinSaved) OutlinedButton(onClick = { SecretStore(ctx.applicationContext, "ussd_pin").set(""); pinSaved = false }) { Text("Remove PIN") }
            }
            Text(
                "The PIN stays encrypted on this phone. It is never sent to the dashboard or anywhere else.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text("5. Let the dashboard check the balance", style = MaterialTheme.typography.bodyMedium)
                    Text("Off means the dashboard's request is refused on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = allowed, onCheckedChange = { allowed = it; settings.ussdAllowed = it })
            }

            Text("Test it now, right here:", style = MaterialTheme.typography.bodyMedium)
            Button(
                enabled = !running,
                onClick = {
                    running = true
                    UssdRunner.run(ctx) { outcome ->
                        UssdCommands.remember(ctx, outcome)
                        running = false
                    }
                },
            ) { Text(if (running) "Checking… keep the screen on" else "Check Nagad balance now") }
            if (last != null) Text(last, style = MaterialTheme.typography.bodyMedium)
            if (steps.isNotBlank()) {
                TextButton(onClick = { details = !details }) { Text(if (details) "Hide what happened" else "Show what happened (send this if it fails)") }
                if (details) Text(steps, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

private fun parseLast(json: String): String? {
    if (json.isBlank()) return null
    return try {
        val o = JSONObject(json)
        val at = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(Date(o.optLong("at")))
        if (o.optBoolean("ok")) "Last check $at: Nagad balance Tk " + String.format(Locale.US, "%,.2f", o.optDouble("balance"))
        else "Last check $at did not work. " + UssdText.error(o.optString("error"))
    } catch (e: Exception) {
        null
    }
}

/** The step-by-step log of the last run (never contains the PIN), for sending to support when something fails. */
private fun lastTrace(json: String): String {
    if (json.isBlank()) return ""
    return try { JSONObject(json).optString("trace", "") } catch (e: Exception) { "" }
}

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

/** Settings card for the dashboard-driven balance check (Nagad and bKash). Everything is set up here, once per phone:
 *  phone permission, which SIM and which PIN for the chosen wallet (kept encrypted on this phone only), and a switch.
 *  [tick] makes the ticks below refresh when the person comes back from Android's settings. */
@Composable
fun UssdCard(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    var provider by remember { mutableStateOf(UssdProviders.NAGAD) }
    val label = UssdProviders.label(provider)
    var allowed by remember { mutableStateOf(settings.ussdAllowed) }
    var slot by remember(provider) { mutableStateOf(settings.ussdSlotOf(provider)) }
    var pin by remember(provider) { mutableStateOf("") }
    var pinSaved by remember(provider) { mutableStateOf(UssdSetup.pinSaved(ctx, provider)) }
    var running by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    // Read again every time the screen refreshes (tick changes), so the ticks follow what Android says.
    val accessibility = UssdSetup.accessibilityOn(ctx)
    val call = UssdSetup.callPermission(ctx)
    val last = remember(tick, running, provider) { parseLast(settings.ussdLastOf(provider), label) }
    val steps = remember(tick, running, provider) { lastTrace(settings.ussdLastOf(provider)) }
    var details by remember { mutableStateOf(false) }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Balance check from the dashboard", style = MaterialTheme.typography.titleSmall)
            Text(
                "When the owner asks, this phone asks the wallet for its balance and reads the answer. It never sends money. Choose the wallet, then set it up once, in this order:",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            // What is switched on is always visible; changing any of it needs the admin code (owner 2026-11-03: these
            // must not be switched off, or on, by whoever is holding the phone).
            val editable = AdminLock.canEdit(ctx)
            LockedSummary(settings, tick)
            if (!editable) {
                Text(
                    "Only the owner can change these. Unlock the important settings with the admin code at the top of this screen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                UssdProviders.all.forEach { p ->
                    FilterChip(selected = provider == p, onClick = { provider = p }, label = { Text(UssdProviders.label(p)) })
                }
            }

            if (UssdLogs.allowed(ctx)) Text(
                "✓ This phone lets PayTrace read the wallet's answer straight from the phone, so no menu has to be opened.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text((if (accessibility) "✓ " else "") + "Backup way (optional): PayTrace in Accessibility", style = MaterialTheme.typography.bodyMedium)
            // Switched on in Settings and actually RUNNING are two different things, and some phones do the first
            // without the second. The owner's Redmi did (2026-11-02): the dialer opened and nothing ever looked at it.
            if (accessibility && !UssdSession.connected()) {
                Text(
                    "⚠ Switched on, but this phone has not actually started it, so nothing is watching the screen.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                Text(
                    "Try in this order. 1) Accessibility settings: switch PayTrace OFF and then ON again. " +
                        "2) If that does not help, this is the \"restricted settings\" block that Redmi and OnePlus put on apps " +
                        "installed outside the Play Store, and it comes BACK with every app update: open PayTrace's app page, " +
                        "tap the three dots at the top right, choose \"Allow restricted settings\" and confirm, then switch it " +
                        "on in Accessibility again. 3) If those three dots are not there, tap the greyed name in Accessibility " +
                        "once, press OK, and look again.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        try { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
                    }) { Text("Accessibility") }
                    OutlinedButton(onClick = {
                        try {
                            ctx.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", ctx.packageName, null))
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            )
                        } catch (e: Exception) { }
                    }) { Text("App page") }
                }
            }
            if (AccessibilityHeal.allowed(ctx)) Text(
                "This phone can switch it back on by itself after an app update.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!accessibility) Text("Normally not needed: PayTrace sends the check straight to the phone network. Switch this on only if the check does not work without it on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!accessibility) {
                Text(
                    "Tap the button, find \"PayTrace balance check\" and switch it on.",
                    style = MaterialTheme.typography.bodySmall,
                )
                OutlinedButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }) { Text("Open Accessibility settings") }
                Text(
                    "If the name is grey and will not switch on (OnePlus, Redmi and other new phones do this for apps installed outside the Play Store): " +
                        "1) tap the grey name once and press OK; 2) tap the button below; 3) tap the three dots at the top right and choose \"Allow restricted settings\", then confirm; " +
                        "4) come back to Accessibility and switch it on. This is needed once per phone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(
                    onClick = {
                        ctx.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", ctx.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    },
                ) { Text("Open PayTrace's app page") }
            }

            Text((if (call) "✓ " else "1. ") + "Allow phone and SIM access (to send the check and pick the SIM)", style = MaterialTheme.typography.bodyMedium)
            if (!call) OutlinedButton(onClick = { permission.launch(arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE)) }) { Text("Allow") }

            Text("2. Which SIM has $label?", style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = slot == 0, onClick = { slot = 0; settings.setUssdSlotOf(provider, 0) }, label = { Text("SIM 1") })
                FilterChip(selected = slot == 1, onClick = { slot = 1; settings.setUssdSlotOf(provider, 1) }, label = { Text("SIM 2") })
            }
            Text(
                "PayTrace uses the SIM you choose here.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text("Way to ask the wallet", style = MaterialTheme.typography.bodyMedium)
            var dialerWay by remember { mutableStateOf(settings.ussdDialerWay) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !dialerWay, onClick = { dialerWay = false; settings.ussdDialerWay = false }, label = { Text("Direct") })
                FilterChip(selected = dialerWay, onClick = { dialerWay = true; settings.ussdDialerWay = true }, label = { Text("Dialer (needs Accessibility)") })
            }
            Text(
                "Direct is quicker. If it keeps failing on this phone, choose Dialer: PayTrace then dials the code like a person would.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text((if (pinSaved) "✓ " else "3. ") + "$label PIN" + if (pinSaved) " saved on this phone" else "", style = MaterialTheme.typography.bodyMedium)
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
                    onClick = { UssdSetup.pinStore(ctx, provider).set(pin); pin = ""; pinSaved = true },
                ) { Text("Save PIN") }
                if (pinSaved) OutlinedButton(onClick = { UssdSetup.pinStore(ctx, provider).set(""); pinSaved = false }) { Text("Remove PIN") }
            }
            Text(
                "The PIN stays encrypted on this phone. It is never sent to the dashboard or anywhere else.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text("4. Let the dashboard check the balance", style = MaterialTheme.typography.bodyMedium)
                    Text("Off means the dashboard's request is refused on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = allowed, onCheckedChange = { allowed = it; settings.ussdAllowed = it })
            }

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).padding(end = 12.dp)) {
                    Text("5. Let the dashboard send money from this phone", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "Off means the dashboard cannot make this phone cash in, whatever it asks. The balance check above is not affected.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                var cashIn by remember { mutableStateOf(settings.cashInAllowed) }
                Switch(checked = cashIn, onCheckedChange = { cashIn = it; settings.cashInAllowed = it })
            }
            Text(
                "Even when it is on, this phone sends only what the dashboard asks for, at most Tk 10,000 at a time, and it " +
                    "stops without typing the PIN unless the wallet's own screen shows that number and that amount.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // The one setting on the phone itself that silently stops every dashboard command.
            if (ScreenWake.locked(ctx)) {
                Text("⚠ This phone has a screen lock", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                Text(
                    "The wallet's menu is drawn by the phone's own dialer, which sits behind the lock screen. Android does " +
                        "not let any app open a locked phone, so while this phone is locked the dashboard cannot check a " +
                        "balance, send a cash-in or read a statement. Take the screen lock off this phone (Settings, " +
                        "Security, Screen lock, None), or unlock it by hand before each command.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(onClick = {
                    try { ctx.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (e: Exception) { }
                }) { Text("Open screen-lock settings") }
            } else {
                Text(
                    "✓ No screen lock, so the dashboard can wake this phone and work on it by itself.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            // MIUI will not let a background app open another app's screen without this, and that is exactly where the
            // owner's Redmi stopped on 2026-11-02: the screen came on and nothing else happened.
            if (ScreenWake.miui()) {
                Text("Xiaomi/Redmi: one more switch", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Open \"Other permissions\" and turn ON \"Display pop-up windows while running in the background\". " +
                        "Without it this phone lights its screen for a dashboard command and then stops, because MIUI will " +
                        "not let PayTrace open the dialer while nothing of ours is on screen. Android cannot report this " +
                        "one, so there is nothing to tick: check it by eye.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedButton(onClick = { ScreenWake.openPopupSetting(ctx) }) { Text("Open other permissions") }
            }

            Text("Test it now, right here:", style = MaterialTheme.typography.bodyMedium)
            Button(
                enabled = !running,
                onClick = {
                    running = true
                    UssdRunner.run(ctx, provider) { outcome ->
                        UssdCommands.remember(ctx, provider, outcome)
                        running = false
                    }
                },
            ) { Text(if (running) "Checking… keep the screen on" else "Check $label balance now") }
            if (last != null) Text(last, style = MaterialTheme.typography.bodyMedium)
            if (steps.isNotBlank()) {
                TextButton(onClick = { details = !details }) { Text(if (details) "Hide what happened" else "Show what happened (send this if it fails)") }
                if (details) Text(steps, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
            }
        }
    }
}

/** The state of the guarded switches, readable by anyone, changeable only with the admin code. */
@Composable
private fun LockedSummary(settings: AppSettings, tick: Int) {
    val ctx = LocalContext.current
    val pins = remember(tick) { UssdProviders.all.map { it to UssdSetup.pinSaved(ctx, it) } }
    val running = UssdSession.connected()
    fun onOff(v: Boolean) = if (v) "ON" else "OFF"
    Text("Balance checks from the dashboard: ${onOff(settings.ussdAllowed)}", style = MaterialTheme.typography.bodyMedium)
    Text("Sending money from this phone: ${onOff(settings.cashInAllowed)}", style = MaterialTheme.typography.bodyMedium)
    Text(
        "Wallet PINs saved: " + pins.joinToString(", ") { (p, saved) -> UssdProviders.label(p) + (if (saved) " ✓" else " –") },
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(
        "Accessibility service: " + if (running) "running ✓" else "not running (tell the owner if balance checks fail)",
        style = MaterialTheme.typography.bodyMedium,
    )
}

private fun parseLast(json: String, label: String): String? {
    if (json.isBlank()) return null
    return try {
        val o = JSONObject(json)
        val at = SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(Date(o.optLong("at")))
        if (o.optBoolean("ok")) "Last check $at: $label balance Tk " + String.format(Locale.US, "%,.2f", o.optDouble("balance"))
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

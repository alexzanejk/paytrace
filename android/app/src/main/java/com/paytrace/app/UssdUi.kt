package com.paytrace.app

import android.Manifest
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }

    // Read again every time the screen refreshes (tick changes), so the ticks follow what Android says.
    val accessibility = UssdSetup.accessibilityOn(ctx)
    val call = UssdSetup.callPermission(ctx)
    val lasts = remember(tick) { UssdProviders.all.mapNotNull { p -> parseLast(settings.ussdLastOf(p), UssdProviders.label(p)) } }
    val steps = remember(tick, provider) { lastTrace(settings.ussdLastOf(provider.ifEmpty { UssdProviders.NAGAD })) }
    var details by remember { mutableStateOf(false) }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Balance check from the dashboard", style = MaterialTheme.typography.titleSmall)
            Text(
                "When the owner asks on the dashboard, this phone asks the wallet for its balance and reads the answer. Set up each wallet once, in this order:",
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

            Text((if (call) "✓ " else "1. ") + "Allow phone access (needed to send the check and to see your SIMs)", style = MaterialTheme.typography.bodyMedium)
            if (!call) OutlinedButton(onClick = { permission.launch(arrayOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE)) }) { Text("Allow") }

            Text("2. Your wallets. Tap one to choose its SIM and save its PIN.", style = MaterialTheme.typography.bodyMedium)
            val sims = remember(tick, call) { SimNames.list(ctx) }
            UssdProviders.all.forEach { p ->
                WalletRow(settings, p, sims, expanded = provider == p, tick = tick, onTap = { provider = if (provider == p) "" else p })
            }
            Text(
                "A PIN stays encrypted on this phone. It is never sent to the dashboard or anywhere else.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text("If checks do not work on this phone", style = MaterialTheme.typography.bodyMedium)
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


            // "Let the dashboard check the balance" and "Let the dashboard send money from this phone" are NOT here any more
            // (owner 2026-11-03): the owner switches them on the dashboard's Phones page, so they cannot be changed by mistake
            // on a phone. This phone just follows (RemoteSwitches). The rules below stay as they were.
            Text(
                "Whether the dashboard may check the balance or make this phone send money is switched on the dashboard (Phones page), not here.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                "Even when sending money is on, this phone sends only what the dashboard asks for, at most Tk 10,000 at a time, and it " +
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

            // "Check balance now" is a dashboard button only (owner 2026-11-03). What the last dashboard check found is shown here.
            lasts.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (steps.isNotBlank()) {
                TextButton(onClick = { details = !details }) { Text(if (details) "Hide what happened" else "Show what happened last (send this if it fails)") }
                if (details) Text(steps, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
            }
        }
    }
}

/** One wallet in the list: a title with a plain status, and when tapped the two things to set, in words a partner understands:
 *  which SIM the wallet's number is in (named by its carrier when Android will tell us) and the wallet PIN. */
@Composable
private fun WalletRow(settings: AppSettings, provider: String, sims: List<SimName>, expanded: Boolean, tick: Int, onTap: () -> Unit) {
    val ctx = LocalContext.current
    val label = UssdProviders.label(provider)
    var slot by remember(provider, tick) { mutableStateOf(settings.ussdSlotOf(provider)) }
    var pin by remember(provider) { mutableStateOf("") }
    var pinSaved by remember(provider, tick) { mutableStateOf(UssdSetup.pinSaved(ctx, provider)) }
    val simText = SimNames.label(slot, sims)
    Card(Modifier.fillMaxWidth().clickable(onClick = onTap), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            Text(
                if (pinSaved) "✓ Ready · $simText · PIN saved" else "Not ready · $simText · type its PIN",
                style = MaterialTheme.typography.bodySmall,
                color = if (pinSaved) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
            )
            if (expanded) {
                Text("Which SIM is your $label number in?", style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(0, 1).forEach { n ->
                        FilterChip(
                            selected = slot == n,
                            onClick = { slot = n; settings.setUssdSlotOf(provider, n) },
                            label = { Text(SimNames.label(n, sims)) },
                        )
                    }
                }
                Text(
                    "The SIM is the one with the $label agent or personal number. If you are not sure, look at Settings, SIM cards on the phone.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(if (pinSaved) "$label PIN is saved" else "Type the $label PIN", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    value = pin,
                    onValueChange = { v -> pin = v.filter { it.isDigit() }.take(8) },
                    label = { Text(if (pinSaved) "New PIN (to replace the saved one)" else "PIN") },
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
    Text("Balance checks (set on the dashboard): ${onOff(settings.ussdAllowed)}", style = MaterialTheme.typography.bodyMedium)
    Text("Sending money (set on the dashboard): ${onOff(settings.cashInAllowed)}", style = MaterialTheme.typography.bodyMedium)
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

package com.paytrace.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Small cards for the Home screen: status, the job to do now, and what the partner has earned. Looks only; the numbers come from the server. */

@Composable
fun StatusPill(healthy: Boolean, configured: Boolean) {
    val label: String
    val color = when {
        healthy -> { label = "Running"; MaterialTheme.colorScheme.primary }
        !configured -> { label = "Not connected"; MaterialTheme.colorScheme.outline }
        else -> { label = "Needs attention"; MaterialTheme.colorScheme.error }
    }
    Row(
        Modifier.background(color.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Text(label, Modifier.padding(start = 8.dp), style = MaterialTheme.typography.labelLarge)
    }
}

/** "কাজ করুন এখনই": what to do, in a box, and the wallet address to do it with. */
@Composable
fun JobCard(job: Job, onSent: suspend (Double, Double) -> String?) {
    val clip = LocalClipboardManager.current
    var copied by remember(job.wallet) { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    // How loud the card is follows the urgency the owner chose: critical is red, urgent is orange, normal is calm.
    val container = when (job.urgency) {
        "critical" -> MaterialTheme.colorScheme.errorContainer
        "urgent" -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.secondaryContainer
    }
    val on = when (job.urgency) {
        "critical" -> MaterialTheme.colorScheme.onErrorContainer
        "urgent" -> MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.onSecondaryContainer
    }
    val urgencyLabel = when (job.urgency) {
        "critical" -> "CRITICAL"
        "urgent" -> "URGENT"
        else -> "NORMAL"
    }
    val who = if (job.agent.isBlank()) EarningsFormat.provider(job.provider) else job.agent + " · " + EarningsFormat.provider(job.provider)

    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = container),
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text("কাজ করুন এখনই", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = on)
                    Text(who + " · balance " + EarningsFormat.money(job.balance), style = MaterialTheme.typography.bodyMedium, color = on)
                }
                Text(
                    urgencyLabel,
                    Modifier.background(on.copy(alpha = 0.14f), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                    color = on,
                )
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                Text(job.instruction, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyLarge)
            }
            Text("Wallet address", style = MaterialTheme.typography.labelLarge, color = on)
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
                Row(
                    Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        job.wallet,
                        Modifier.weight(1f).padding(end = 8.dp),
                        style = MaterialTheme.typography.titleMedium,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                    )
                    FilledTonalButton(onClick = { clip.setText(AnnotatedString(job.wallet)); copied = true }) { Text(if (copied) "Copied" else "Copy") }
                }
            }
            if (job.network.isNotBlank()) {
                Column {
                    Text("Network: " + job.network, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = on)
                    Text("Send only on this network, or the money can be lost.", style = MaterialTheme.typography.bodySmall, color = on)
                }
            }
            Button(onClick = { confirm = true }, Modifier.fillMaxWidth()) { Text("I sent it") }
        }
    }

    if (confirm) {
        SendDialog(
            title = "How much did you send?",
            text = "Type exactly what left the wallet, then the P2P charge. PayTrace checks it against the next cash-out message.",
            initialAmount = "",
            initialCharge = "",
            onSubmit = onSent,
            onClose = { confirm = false },
        )
    }
}

/** Asks how much was sent and what the P2P charge was. [onSubmit] returns null when the server accepted it, or the words to show if not. */
@Composable
fun SendDialog(
    title: String,
    text: String,
    initialAmount: String,
    initialCharge: String,
    onSubmit: suspend (Double, Double) -> String?,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var amount by remember { mutableStateOf(initialAmount) }
    var charge by remember { mutableStateOf(initialCharge) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(text, style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(
                    amount, { amount = it; problem = null }, Modifier.fillMaxWidth(),
                    label = { Text("Amount you sent (Tk)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    charge, { charge = it; problem = null }, Modifier.fillMaxWidth(),
                    label = { Text("P2P charge (Tk)") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            }
        },
        confirmButton = {
            Button(
                enabled = !busy,
                onClick = {
                    val a = MoneyInput.parse(amount)
                    val c = if (charge.isBlank()) 0.0 else MoneyInput.parse(charge)
                    if (a == null || a <= 0.0 || c == null) {
                        problem = "Type the amount and the charge in taka, for example 10000 and 50."
                    } else {
                        busy = true
                        scope.launch {
                            val err = onSubmit(a, c)
                            busy = false
                            if (err == null) onClose() else problem = err
                        }
                    }
                },
            ) { Text(if (busy) "Sending…" else "Send for checking") }
        },
        dismissButton = { TextButton(onClick = onClose, enabled = !busy) { Text("Cancel") } },
    )
}

/** What happened to a send the partner submitted: waiting (yellow), verified (green), or not adding up (red). */
@Composable
fun TransferCard(t: Transfer, onFix: suspend (Double, Double) -> String?) {
    var fixing by remember { mutableStateOf(false) }
    val green = Color(0xFF146C43) to Color(0xFFD7F2E3)
    val amber = Color(0xFF8A5300) to Color(0xFFFFE8C2)
    val red = MaterialTheme.colorScheme.onErrorContainer to MaterialTheme.colorScheme.errorContainer
    val (on, container) = when (t.status) {
        "verified" -> green
        "checking" -> amber
        else -> red
    }
    val headline = when (t.status) {
        "verified" -> "Verified ✓ Job complete"
        "checking" -> "Waiting for confirmation"
        "mismatch" -> "Doesn't add up"
        "review" -> "Doesn't add up. The owner will check"
        else -> "Not accepted"
    }
    val detail = when (t.status) {
        "verified" -> "The next cash-out message matches what you sent."
        "checking" -> "PayTrace confirms it with the next cash-out message for this wallet. Nothing more to do."
        "mismatch" -> "The amount or the charge you typed does not match the wallet's balance. Check them and fix once."
        "review" -> "The owner has been told. You do not need to do anything."
        else -> "The owner did not accept this send. Ask them."
    }
    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = container)) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(headline, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = on)
            Text(
                "Sent " + EarningsFormat.money(t.amount) + " · charge " + EarningsFormat.money(t.charge) + " · " + EarningsFormat.provider(t.provider),
                style = MaterialTheme.typography.bodyMedium, color = on,
            )
            Text(detail, style = MaterialTheme.typography.bodySmall, color = on)
            if (t.canFix) Button(onClick = { fixing = true }, Modifier.fillMaxWidth()) { Text("Fix the numbers") }
        }
    }
    if (fixing) {
        SendDialog(
            title = "Fix the numbers",
            text = "You can change them once. Look at your wallet history and type exactly what left the wallet.",
            initialAmount = t.amount.toLong().toString(),
            initialCharge = if (t.charge == 0.0) "" else t.charge.toString(),
            onSubmit = { a, c -> onFix(a, c) },
            onClose = { fixing = false },
        )
    }
}

/** What the partner is owed, in one tap-able card on Home. [onOpen] goes to the Earnings tab. */
@Composable
fun EarningsSummaryCard(e: Earnings, onOpen: () -> Unit) {
    val on = MaterialTheme.colorScheme.onPrimaryContainer
    val due = if (e.owed > 0) e.owed else 0.0
    Card(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).clickable(onClick = onOpen),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(if (due > 0) "Due to you" else "All paid up", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = on)
                Text("Details ›", style = MaterialTheme.typography.labelLarge, color = on)
            }
            Text(EarningsFormat.money(due), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = on)
            Text(
                "Earned today " + EarningsFormat.money(e.today.commission) + " · this month " + EarningsFormat.money(e.month.commission),
                style = MaterialTheme.typography.bodySmall, color = on,
            )
        }
    }
}

/** A small heading for a group of cards, with an optional count on the right. */
@Composable
fun SectionTitle(text: String, count: Int? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (count != null && count > 0) {
            Text(
                "$count",
                Modifier.background(MaterialTheme.colorScheme.primary, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 2.dp),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimary,
            )
        }
    }
}

/** Shown on Home when there is no job: calm, and says what will happen. */
@Composable
fun EmptyJobsCard() {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("No job right now", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "When a wallet's balance reaches the amount, the phone rings and the job shows here.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun StatTile(label: String, value: String, sub: String, modifier: Modifier = Modifier) {
    Card(
        modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

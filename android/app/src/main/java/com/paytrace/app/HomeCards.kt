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
import androidx.compose.ui.graphics.Brush
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
    val cashIn = job.isCashIn
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
            Text(if (cashIn) "Cash in to this number" else "Wallet address", style = MaterialTheme.typography.labelLarge, color = on)
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
            if (!cashIn && job.network.isNotBlank()) {
                Column {
                    Text("Network: " + job.network, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = on)
                    Text("Send only on this network, or the money can be lost.", style = MaterialTheme.typography.bodySmall, color = on)
                }
            }
            Button(onClick = { confirm = true }, Modifier.fillMaxWidth()) { Text(if (cashIn) "I did it" else "I sent it") }
        }
    }

    if (confirm) {
        SendDialog(
            title = if (cashIn) "How much did you cash in?" else "How much did you send?",
            text = if (cashIn) "Type the exact cash-in amount, then the cash-in commission your wallet gave you for it (for example 0.38 on 100). A cash-in sends no SMS, so PayTrace checks these numbers against the next cash-out message."
            else "Type exactly what left the wallet, then the P2P charge. PayTrace checks it against the next cash-out message.",
            initialAmount = "",
            initialCharge = "",
            amountLabel = if (cashIn) "Cash-in amount (Tk)" else "Amount you sent (Tk)",
            chargeLabel = if (cashIn) "Cash-in commission you got (Tk)" else "P2P charge (Tk)",
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
    amountLabel: String = "Amount you sent (Tk)",
    chargeLabel: String = "P2P charge (Tk)",
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
                    label = { Text(amountLabel) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    charge, { charge = it; problem = null }, Modifier.fillMaxWidth(),
                    label = { Text(chargeLabel) }, singleLine = true,
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

/** The big card at the top of Home: what is due to the partner now, with today, this month and what was paid in the last 3 days
 *  beneath it. Tapping it opens the Earnings tab. Shows why it is empty when earnings are off for this phone. */
@Composable
fun BalanceCard(e: Earnings?, onOpen: () -> Unit) {
    val white = Color.White
    val soft = Color.White.copy(alpha = 0.82f)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(balanceGradient(ThemeState.dark)))
            .clickable(onClick = onOpen).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (e == null) {
            Text("Earnings", style = MaterialTheme.typography.labelLarge, color = soft)
            Text("Loading…", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = white)
        } else if (!e.enabled) {
            Text("Earnings", style = MaterialTheme.typography.labelLarge, color = soft)
            Text("Not switched on for this phone", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = white)
            Text("The owner switches them on in the dashboard: Phones, then Partner commission.", style = MaterialTheme.typography.bodySmall, color = soft)
        } else {
            val due = if (e.owed > 0) e.owed else 0.0
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(if (due > 0) "Due to you" else "All paid up", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = soft)
                Text("Details \u203A", style = MaterialTheme.typography.labelLarge, color = soft)
            }
            Text(EarningsFormat.money(due), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = white)
            Text(
                "Earned " + EarningsFormat.money(e.earned) + " in total \u00B7 paid " + EarningsFormat.money(e.paid),
                style = MaterialTheme.typography.bodySmall, color = soft,
            )
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MiniFigure("Today", EarningsFormat.money(e.today.commission), Modifier.weight(1f))
                MiniFigure("This month", EarningsFormat.money(e.month.commission), Modifier.weight(1f))
                MiniFigure("Paid, 3 days", EarningsFormat.money(e.recentPaid.sumOf { it.amount }), Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun MiniFigure(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier.background(Color.White.copy(alpha = 0.16f), RoundedCornerShape(16.dp)).padding(horizontal = 10.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.82f), maxLines = 1)
        Text(value, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = Color.White, maxLines = 1)
    }
}

/** What was paid to the partner in the last 3 days (today and the two days before), right on Home. */
@Composable
fun PaidRecentCard(e: Earnings) {
    val st = statusColors()
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Paid to you, last 3 days", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (e.recentPaid.isNotEmpty()) {
                    Text(EarningsFormat.money(e.recentPaid.sumOf { it.amount }), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = st.ok)
                }
            }
            if (e.recentPaid.isEmpty()) {
                Text("Nothing was paid to you in the last 3 days.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                e.recentPaid.forEach { p ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(EarningsFormat.dayLabel(p.day), style = MaterialTheme.typography.bodyMedium)
                            if (p.note.isNotBlank()) Text(p.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Text(EarningsFormat.money(p.amount), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** One send the partner submitted, on one compact row: what was sent, when, and how the check went (green, waiting, or red with what to do). */
@Composable
fun ActivityRow(t: Transfer, onFix: suspend (Double, Double) -> String?) {
    val st = statusColors()
    var fixing by remember { mutableStateOf(false) }
    val (mark, fg, bg) = when (t.status) {
        "verified" -> Triple("\u2713", st.ok, st.okBg)
        "checking" -> Triple("\u2026", st.warn, st.warnBg)
        else -> Triple("!", st.bad, st.badBg)
    }
    val chip = when (t.status) {
        "verified" -> "Verified"
        "checking" -> "Waiting"
        "mismatch" -> "Check"
        "review" -> "With owner"
        else -> "Rejected"
    }
    val line = when (t.status) {
        "verified" -> "The next cash-out message matches. Job complete."
        "checking" -> "Waiting for the next cash-out message for this wallet."
        "mismatch" -> "Does not add up. Check what you typed and fix it once."
        "review" -> "Does not add up. The owner will check it."
        else -> if (t.note.isNotBlank()) "Rejected by the owner: " + t.note else "Rejected by the owner."
    }
    val whenText = EarningsFormat.whenText(t.submittedAt)
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(38.dp).background(bg, CircleShape), contentAlignment = Alignment.Center) {
                    Text(mark, color = fg, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                }
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text((if (t.isCashIn) "Cash in " else "Sent ") + EarningsFormat.money(t.amount), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        EarningsFormat.provider(t.provider) + (if (t.isCashIn) " \u00B7 commission " else " \u00B7 charge ") + EarningsFormat.money(t.charge) + (if (whenText.isNotBlank()) " \u00B7 $whenText" else ""),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    chip,
                    Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = fg,
                )
            }
            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (t.canFix) Button(onClick = { fixing = true }, Modifier.fillMaxWidth()) { Text("Fix the numbers") }
        }
    }
    if (fixing) {
        SendDialog(
            title = "Fix the numbers",
            text = if (t.isCashIn) "You can change them once. Look at your cash-in receipt and type the exact amount and the commission you got."
            else "You can change them once. Look at your wallet history and type exactly what left the wallet.",
            initialAmount = t.amount.toLong().toString(),
            initialCharge = if (t.charge == 0.0) "" else t.charge.toString(),
            amountLabel = if (t.isCashIn) "Cash-in amount (Tk)" else "Amount you sent (Tk)",
            chargeLabel = if (t.isCashIn) "Cash-in commission you got (Tk)" else "P2P charge (Tk)",
            onSubmit = { a, c -> onFix(a, c) },
            onClose = { fixing = false },
        )
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

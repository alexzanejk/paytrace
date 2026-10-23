package com.paytrace.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

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
fun JobCard(job: Job, onDone: () -> Unit) {
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
            Button(onClick = { confirm = true }, Modifier.fillMaxWidth()) { Text("Done") }
        }
    }

    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Is the work finished?") },
            text = { Text("Tap Yes only after you have done it. The job comes back only if a newer balance is still above the amount.") },
            confirmButton = { Button(onClick = { confirm = false; onDone() }) { Text("Yes, done") } },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Not yet") } },
        )
    }
}

/** The big number: what the partner has earned and not been paid yet. */
@Composable
fun BalanceHero(e: Earnings) {
    val on = MaterialTheme.colorScheme.onPrimary
    val balance = if (e.owed > 0) e.owed else 0.0
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
    ) {
        Column(Modifier.fillMaxWidth().padding(22.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Your earning balance", style = MaterialTheme.typography.labelLarge, color = on)
            Text(EarningsFormat.money(balance), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = on)
            Text("Earned and not paid to you yet", style = MaterialTheme.typography.bodySmall, color = on)
            Spacer(Modifier.height(10.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Earned in total", style = MaterialTheme.typography.bodySmall, color = on)
                    Text(EarningsFormat.money(e.earned), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = on)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("Paid to you so far", style = MaterialTheme.typography.bodySmall, color = on)
                    Text(EarningsFormat.money(e.paid), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = on)
                }
            }
        }
    }
}

@Composable
fun StatTile(label: String, value: String, sub: String, modifier: Modifier = Modifier) {
    Card(
        modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Earnings in plain words: the balance first, then today and this month, then the last week. Shown only when the owner switched it on. */
@Composable
fun EarningsSection(e: Earnings) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        BalanceHero(e)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("Earned today", EarningsFormat.money(e.today.commission), "on " + EarningsFormat.money(e.today.total), Modifier.weight(1f))
            StatTile("This month", EarningsFormat.money(e.month.commission), "on " + EarningsFormat.money(e.month.total), Modifier.weight(1f))
        }
        Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (e.todayDetail.isNotEmpty()) {
                    Text("Today by account", style = MaterialTheme.typography.titleSmall)
                    e.todayDetail.forEach {
                        Text(
                            EarningsFormat.provider(it.provider) + " " + EarningsFormat.kind(it.kind) + ": " + EarningsFormat.line(it),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                }
                if (e.days.isNotEmpty()) {
                    Text("Last 7 days", style = MaterialTheme.typography.titleSmall)
                    e.days.forEach {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Column(Modifier.weight(1f)) {
                                Text(EarningsFormat.dayLabel(it.day), style = MaterialTheme.typography.bodyMedium)
                                Text("on " + EarningsFormat.money(it.total), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(EarningsFormat.money(it.commission), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (e.rates.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Your rates: " + e.rates.joinToString(" · ") { EarningsFormat.rateLine(it) },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    "Commission is a share of what comes through this phone each day (12:00 AM to 11:59 PM Bangladesh time). Payments held for checking count once they are approved.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

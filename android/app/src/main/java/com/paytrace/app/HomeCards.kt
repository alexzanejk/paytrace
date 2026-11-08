package com.paytrace.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
fun JobCard(job: Job, onSent: suspend (SendForm) -> String?) {
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
            // A Taka job may send to our number of ANY type (a Rocket wallet to our bKash number); the server names it in `network`.
            Text(
                if (!cashIn) "Wallet address" else if (job.network.isNotBlank()) "Send to our ${job.network} number" else "Send to this number",
                style = MaterialTheme.typography.labelLarge, color = on,
            )
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
            title = "How much did you send?",
            text = if (cashIn) "Type the exact amount you sent to our number and the commission your wallet gave you. If anything else cost you money (a fund transfer, a charge), type it under Other cost and write what it was for. PayTrace checks these numbers against the next cash-out message."
            else "Type exactly what left the wallet, then the P2P charge. If anything else cost you money, type it under Other cost and write what it was for. PayTrace checks it against the next cash-out message.",
            initialAmount = "",
            initialCharge = "",
            amountLabel = "Amount you sent (Tk)",
            chargeLabel = if (cashIn) "Commission or charge (Tk)" else "P2P charge (Tk)",
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
    onSubmit: suspend (SendForm) -> String?,
    onClose: () -> Unit,
    amountLabel: String = "Amount you sent (Tk)",
    chargeLabel: String = "P2P charge (Tk)",
    initialCost: String = "",
    initialCostNote: String = "",
) {
    val scope = rememberCoroutineScope()
    var amount by remember { mutableStateOf(initialAmount) }
    var charge by remember { mutableStateOf(initialCharge) }
    var cost by remember { mutableStateOf(initialCost) }
    var costNote by remember { mutableStateOf(initialCostNote) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text(title) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                // Anything else the job cost (a fund-transfer fee, a P2P fee ...) and what it was for: the owner reads it with the send.
                OutlinedTextField(
                    cost, { cost = it; problem = null }, Modifier.fillMaxWidth(),
                    label = { Text("Other cost (Tk), if any") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                OutlinedTextField(
                    costNote, { costNote = it.take(SendForm.NOTE_MAX); problem = null }, Modifier.fillMaxWidth(),
                    label = { Text("What did it cost for?") },
                    placeholder = { Text("e.g. fund transfer fee 25, bKash charge 10") },
                    minLines = 2, maxLines = 4,
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
                    val o = if (cost.isBlank()) 0.0 else MoneyInput.parse(cost)
                    if (a == null || a <= 0.0 || c == null) {
                        problem = "Type the amount and the charge in taka, for example 10000 and 50."
                    } else if (o == null || o < 0.0) {
                        problem = "Type the other cost in taka, for example 25, or leave it empty."
                    } else if (o > 0.0 && costNote.isBlank()) {
                        problem = "Write what the other cost was for."
                    } else {
                        busy = true
                        scope.launch {
                            val err = onSubmit(SendForm(a, c, o, costNote.trim()))
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
fun ActivityRow(t: Transfer, onFix: suspend (SendForm) -> String?) {
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
                        EarningsFormat.provider(t.provider) + (if (t.isCashIn) " \u00B7 commission " else " \u00B7 charge ") + EarningsFormat.money(t.charge) +
                            (if (t.cost > 0.0) " \u00B7 other cost " + EarningsFormat.money(t.cost) else "") + (if (whenText.isNotBlank()) " \u00B7 $whenText" else ""),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (t.costNote.isNotBlank()) Text("Cost: " + t.costNote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            onSubmit = { f -> onFix(f) },
            onClose = { fixing = false },
            initialCost = if (t.cost == 0.0) "" else t.cost.toString(),
            initialCostNote = t.costNote,
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

/** "We did a B2B" (owner 2026-11-08): a B2B sends no SMS PayTrace can rely on, so after one the partner taps here and the
 *  phone reads that wallet's statement at once, before the entry can scroll off the wallet's list. Only for wallets this
 *  phone can read (bKash and Nagad with the PIN saved) and only while the dashboard allows balance reads. */
@Composable
fun B2bCard(settings: AppSettings, wallets: List<String>) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Did a B2B?", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(
                "Tap right after you send or receive a B2B. The phone reads the wallet's statement so the money is recorded.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                wallets.forEach { p ->
                    val label = UssdProviders.label(p)
                    FilledTonalButton(enabled = !busy, onClick = {
                        busy = true
                        note = ""
                        scope.launch {
                            val answer = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { JobsApi.b2bDone(settings, p) }
                            note = B2bAnswer.text(answer, label)
                            // Take the statement command at once instead of on the next 30-second beat.
                            HeartbeatWorker.now(ctx)
                            busy = false
                        }
                    }) { Text("B2B on $label") }
                }
            }
            if (note.isNotEmpty()) Text(note, style = MaterialTheme.typography.bodySmall)
        }
    }
}

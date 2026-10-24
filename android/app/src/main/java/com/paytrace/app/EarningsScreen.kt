package com.paytrace.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** The Earnings tab: what is due to the partner, this month's commission day 1 to the last day, and what was paid in the last three days.
 *  Older payments are deliberately not shown. Only the owner's switch in the dashboard makes this appear. */
@Composable
fun EarningsScreen(e: Earnings?) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Earnings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        if (e == null) {
            Quiet("Loading your earnings…")
            return@Column
        }
        if (!e.enabled) {
            Quiet("Earnings are not switched on for this phone. Ask the owner if you should see them.")
            return@Column
        }
        DueHero(e)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("Earned today", EarningsFormat.money(e.today.commission), "on " + EarningsFormat.money(e.today.total), Modifier.weight(1f))
            StatTile(
                "This month",
                EarningsFormat.money(e.month.commission),
                EarningsFormat.rangeLabel(e.monthStart, e.monthEnd).ifBlank { "on " + EarningsFormat.money(e.month.total) },
                Modifier.weight(1f),
            )
        }
        PaidRecently(e)
        MonthByDay(e)
        HowItWorks(e)
    }
}

@Composable
private fun Quiet(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The big number: everything earned minus everything the owner has paid. */
@Composable
private fun DueHero(e: Earnings) {
    val on = MaterialTheme.colorScheme.onPrimaryContainer
    val due = if (e.owed > 0) e.owed else 0.0
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(if (due > 0) "Due to you" else "All paid up", style = MaterialTheme.typography.labelLarge, color = on)
            Text(EarningsFormat.money(due), style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold, color = on)
            Text(
                if (due > 0) "Earned and not paid to you yet" else "Nothing is waiting to be paid to you",
                style = MaterialTheme.typography.bodySmall, color = on,
            )
            Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
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
private fun Panel(title: String, content: @Composable () -> Unit) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

/** Only the last three days of payments (today and the two days before), and how much was paid this month. */
@Composable
private fun PaidRecently(e: Earnings) {
    Panel("Paid to you in the last 3 days") {
        if (e.recentPaid.isEmpty()) {
            Quiet("Nothing was paid to you in the last 3 days.")
        } else {
            e.recentPaid.forEachIndexed { i, p ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(EarningsFormat.dayLabel(p.day), style = MaterialTheme.typography.bodyMedium)
                        if (p.note.isNotBlank()) Text(p.note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(EarningsFormat.money(p.amount), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary)
                }
            }
        }
        Text(
            "Older payments are not shown here. Paid this month so far: " + EarningsFormat.money(e.paidMonth),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Commission for the whole month, day 1 to the last day. Days still to come are not listed, they are 0 until they happen. */
@Composable
private fun MonthByDay(e: Earnings) {
    val range = EarningsFormat.rangeLabel(e.monthStart, e.monthEnd)
    val upToToday = e.monthDays.filter { e.day.isBlank() || it.day <= e.day }
    Panel(if (range.isBlank()) "This month, day by day" else "This month ($range)") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Commission for the month", style = MaterialTheme.typography.bodyMedium)
            Text(EarningsFormat.money(e.month.commission), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (upToToday.isEmpty()) {
            Quiet("No days yet.")
        } else {
            upToToday.forEach {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(EarningsFormat.dayLabel(it.day), style = MaterialTheme.typography.bodyMedium)
                        if (it.total > 0) Text("on " + EarningsFormat.money(it.total), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(
                        EarningsFormat.money(it.commission),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (it.commission > 0) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (it.commission > 0) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun HowItWorks(e: Earnings) {
    Panel("How it is worked out") {
        if (e.todayDetail.isNotEmpty()) {
            Text("Today by account", style = MaterialTheme.typography.titleSmall)
            e.todayDetail.forEach {
                Text(EarningsFormat.provider(it.provider) + " " + EarningsFormat.kind(it.kind) + ": " + EarningsFormat.line(it), style = MaterialTheme.typography.bodySmall)
            }
        }
        if (e.rates.isNotEmpty()) {
            Text("Your rates: " + e.rates.joinToString(" · ") { EarningsFormat.rateLine(it) }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            "Commission is a share of what comes through this phone each day (12:00 AM to 11:59 PM Bangladesh time). Payments held for checking count once they are approved.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

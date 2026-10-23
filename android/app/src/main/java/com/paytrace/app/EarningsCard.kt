package com.paytrace.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** The partner's earnings, on the Home tab. It appears only when the owner switched "show earnings" on for this phone in the
 *  dashboard, so every other phone keeps the plain Home screen. Refreshes while Home is open; if the internet drops it keeps
 *  showing the last numbers. */
@Composable
fun EarningsCard(settings: AppSettings) {
    var data by remember { mutableStateOf<Earnings?>(null) }
    val approved = settings.deviceStatus == "approved"
    LaunchedEffect(approved) {
        if (!approved) return@LaunchedEffect
        while (true) {
            val r = withContext(Dispatchers.IO) { EarningsApi.fetch(settings) }
            if (r != null) data = r
            delay(60_000)
        }
    }
    val e = data
    if (e == null || !e.enabled) return

    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Your earnings", style = MaterialTheme.typography.titleMedium)
            Column {
                Text("Earned today", style = MaterialTheme.typography.bodySmall)
                Text(EarningsFormat.money(e.today.commission), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Text("on " + EarningsFormat.money(e.today.total) + " received today", style = MaterialTheme.typography.bodySmall)
            }
            e.todayDetail.forEach {
                Text(EarningsFormat.provider(it.provider) + " " + EarningsFormat.kind(it.kind) + ": " + EarningsFormat.line(it), style = MaterialTheme.typography.bodySmall)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("This month", style = MaterialTheme.typography.bodySmall)
                    Text(EarningsFormat.money(e.month.commission), fontWeight = FontWeight.Medium)
                }
                Column {
                    Text("Paid so far", style = MaterialTheme.typography.bodySmall)
                    Text(EarningsFormat.money(e.paid), fontWeight = FontWeight.Medium)
                }
                Column {
                    Text("Still to receive", style = MaterialTheme.typography.bodySmall)
                    Text(EarningsFormat.money(if (e.owed > 0) e.owed else 0.0), fontWeight = FontWeight.Medium)
                }
            }
            if (e.days.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Last 7 days", style = MaterialTheme.typography.bodySmall)
                    e.days.forEach {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(EarningsFormat.dayLabel(it.day), style = MaterialTheme.typography.bodySmall)
                            Text(
                                EarningsFormat.money(it.total) + "  →  " + EarningsFormat.money(it.commission),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
            if (e.rates.isNotEmpty()) {
                Text(
                    "Your rates: " + e.rates.joinToString(" · ") { EarningsFormat.rateLine(it) },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Text(
                "Commission is a share of what comes through this phone each day (12:00 AM to 11:59 PM Bangladesh time). Payments held for checking count once they are approved.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

package com.paytrace.app

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/** The phone-settings checklist for this phone brand: for each setting, where to find it, the exact option to choose and
 *  the one to avoid, a button that opens the right page, and a tick the owner sets when it is done. Android cannot read
 *  these settings, so the tick is the owner's word; it is kept on the phone. [onChanged] lets the caller re-check. */
@Composable
fun PhoneSettingsGuide(settings: AppSettings, onChanged: () -> Unit = {}) {
    val ctx = LocalContext.current
    val steps = remember { Setup.guide(Build.MANUFACTURER) }
    var done by remember { mutableStateOf(settings.guideDone) }
    val finished = steps.count { it.id in done }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            if (finished == steps.size) "All ${steps.size} settings are done. Thank you."
            else "$finished of ${steps.size} settings done",
            style = MaterialTheme.typography.titleSmall,
            color = if (finished == steps.size) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
        )
        steps.forEachIndexed { index, step ->
            val isDone = step.id in done
            Card(
                Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (isDone) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                ),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("${index + 1}. ${step.title}", style = MaterialTheme.typography.titleSmall)
                    Text("Where: ${step.path}", style = MaterialTheme.typography.bodySmall)
                    Text(
                        "Choose: ${step.choose}",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    if (step.avoid != null) {
                        Text("Not: ${step.avoid}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    Text(step.why, style = MaterialTheme.typography.bodySmall)
                    if (step.open != Setup.Open.NONE) {
                        Button(onClick = {
                            when (step.open) {
                                Setup.Open.AUTOSTART_PAGE -> openAutostartPage(ctx)
                                Setup.Open.BATTERY_SETTINGS -> openBatterySettings(ctx)
                                Setup.Open.APP_DETAILS -> openAppDetails(ctx)
                                Setup.Open.NONE -> Unit
                            }
                        }) { Text("Open this page") }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = isDone,
                            onCheckedChange = { on ->
                                done = if (on) done + step.id else done - step.id
                                settings.guideDone = done
                                onChanged()
                            },
                        )
                        Text("I have done this", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
        Text(
            "Wording differs a little between phone models. If you cannot find a setting, search for its name in the phone's Settings.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

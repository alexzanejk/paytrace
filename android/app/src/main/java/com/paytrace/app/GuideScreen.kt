package com.paytrace.app

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/** The phone-settings guide: what to change so the phone never stops PayTrace, one card per setting.
 *  Each card says where the setting lives, the exact option to choose and the one to avoid, and its Open button walks through several
 *  real pages (the phone brand's own page, then the system's, then PayTrace's app page, which every phone has) so a wrong or empty page
 *  is one tap from the next. Above the cards, "Phone check" shows what Android itself reports; below them, the screen-off test proves it. */
@Composable
fun PhoneSettingsGuide(settings: AppSettings, onChanged: () -> Unit = {}) {
    val ctx = LocalContext.current
    val steps = remember { Setup.guide(Build.MANUFACTURER) }
    var done by remember { mutableStateOf(settings.guideDone) }
    var phone by remember { mutableStateOf(PhoneCheck.read(ctx)) }
    var verified by remember { mutableStateOf(Setup.autoVerified(ctx)) }
    var pulse by remember { mutableIntStateOf(0) }

    // While the screen is open: re-read what the phone says (so coming back from Settings updates it at once) and close a finished test.
    WhileVisible(Unit) {
        while (true) {
            phone = PhoneCheck.read(ctx)
            verified = Setup.autoVerified(ctx)
            StayAwake.finishIfDue(settings)
            pulse++
            delay(2000)
        }
    }

    val finished = steps.count { it.id in done || it.id in verified }
    val all = finished == steps.size

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (all) "All ${steps.size} settings are done. Thank you." else "$finished of ${steps.size} settings done",
                style = MaterialTheme.typography.titleSmall,
                color = if (all) statusColors().ok else MaterialTheme.colorScheme.error,
            )
            LinearProgressIndicator(progress = { if (steps.isEmpty()) 1f else finished.toFloat() / steps.size }, Modifier.fillMaxWidth())
        }

        PhoneCheckCard(phone)

        steps.forEachIndexed { index, step ->
            StepCard(
                index = index + 1,
                step = step,
                ways = remember(step.id) { SettingsWays.forStep(step.id, Build.MANUFACTURER) },
                done = step.id in done,
                verifiedByPhone = step.id in verified,
                onToggle = { on ->
                    done = if (on) done + step.id else done - step.id
                    settings.guideDone = done
                    onChanged()
                },
            )
        }

        StayAwakeCard(settings, pulse)

        Text(
            "Wording differs a little between phone models. If a page is wrong or empty, tap \"Try another page\"; the last choices are PayTrace's own app page and the phone's Settings, which every phone has.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun levelColor(level: PhoneCheck.Level): Color {
    val st = statusColors()
    return when (level) {
        PhoneCheck.Level.GOOD -> st.ok
        PhoneCheck.Level.WARN -> st.warn
        PhoneCheck.Level.BAD -> st.bad
        PhoneCheck.Level.UNKNOWN -> MaterialTheme.colorScheme.outline
    }
}

/** What Android itself says about PayTrace right now. Not a replacement for the steps (the phone brand's own settings cannot be read). */
@Composable
private fun PhoneCheckCard(lines: List<PhoneCheck.Line>) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Phone check", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            lines.forEach { l ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.padding(top = 5.dp).size(10.dp).background(levelColor(l.level), CircleShape))
                    Column(Modifier.padding(start = 10.dp)) {
                        Text(l.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        Text(l.answer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Text(
                "This is what Android reports. Your phone brand's own power manager is checked by the screen-off test below.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StepCard(
    index: Int,
    step: Setup.GuideStep,
    ways: List<Way>,
    done: Boolean,
    verifiedByPhone: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val ctx = LocalContext.current
    val st = statusColors()
    var tried by remember(step.id) { mutableIntStateOf(-1) } // index of the page last opened; -1 = none yet
    var opened by remember(step.id) { mutableStateOf<String?>(null) }
    val complete = done || verifiedByPhone

    fun openFrom(from: Int) {
        val idx = SettingsOpener.openFrom(ctx, ways, from)
        if (idx == null) {
            tried = -1
            opened = null
        } else {
            tried = idx
            opened = ways[idx].label
        }
    }

    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = if (complete) st.okBg else MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(30.dp).background(if (complete) st.ok else MaterialTheme.colorScheme.primary, CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        if (complete) "✓" else "$index",
                        color = if (complete) st.okBg else MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
                Text(step.title, Modifier.padding(start = 12.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Text("Where: ${step.path}", style = MaterialTheme.typography.bodySmall)
            Text(
                "Choose: ${step.choose}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            if (step.avoid != null) {
                Text("Not: ${step.avoid}", style = MaterialTheme.typography.bodySmall, color = st.bad)
            }
            Text(step.why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            if (step.open != Setup.Open.NONE) {
                if (tried < 0) {
                    Button(onClick = { openFrom(0) }, Modifier.fillMaxWidth()) { Text("Open this page") }
                } else {
                    Text("Opened: $opened", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    val last = tried + 1 >= ways.size
                    OutlinedButton(onClick = { openFrom(if (last) 0 else tried + 1) }, Modifier.fillMaxWidth()) {
                        Text(if (last) "Start again from the first page" else "Not the right page? Try another")
                    }
                    if (ways[tried].id != SettingsWays.APP_INFO.id) {
                        TextButton(onClick = { SettingsOpener.start(ctx, SettingsWays.APP_INFO) }) { Text("Open PayTrace's app page") }
                    }
                }
            }

            when {
                verifiedByPhone -> Text("✓ The phone confirms this one", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = st.ok)
                done -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("✓ Done", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = st.ok)
                    TextButton(onClick = { onToggle(false) }) { Text("Undo") }
                }
                else -> OutlinedButton(onClick = { onToggle(true) }, Modifier.fillMaxWidth()) { Text("I did this") }
            }
        }
    }
}

/** The proof: lock the phone for 10 minutes and see whether PayTrace kept running the whole time. */
@Composable
private fun StayAwakeCard(settings: AppSettings, pulse: Int) {
    val st = statusColors()
    // `pulse` changes every two seconds while the screen is open, so the numbers below are re-read from the phone.
    @Suppress("UNUSED_VARIABLE") val unused = pulse
    val running = StayAwake.running(settings)
    val result = settings.testResult
    val at = EarningsFormat.whenMillis(settings.testResultAt)
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = when {
                running -> MaterialTheme.colorScheme.primaryContainer
                result == "pass" -> st.okBg
                result == "fail" -> st.badBg
                else -> MaterialTheme.colorScheme.surfaceContainerHigh
            },
        ),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Screen-off test", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            when {
                running -> {
                    Text(
                        "Test running. Lock the phone now and put it down. Come back in about ${StayAwake.minutesLeft(settings)} minute(s) and open PayTrace to see the result.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    OutlinedButton(onClick = { StayAwake.cancel(settings) }, Modifier.fillMaxWidth()) { Text("Cancel the test") }
                }
                else -> {
                    when (result) {
                        "pass" -> Text(
                            "✓ Passed${if (at.isNotEmpty()) " ($at)" else ""}: PayTrace kept running with the screen off for ${settings.testScreenOffMin} minutes. The longest silence was ${settings.testResultGapS} seconds.",
                            style = MaterialTheme.typography.bodyMedium, color = st.ok, fontWeight = FontWeight.Medium,
                        )
                        "fail" -> Text(
                            "Failed${if (at.isNotEmpty()) " ($at)" else ""}: PayTrace was silent for ${settings.testResultGapS} seconds, so the phone stopped it. Go through the settings above again, then test again.",
                            style = MaterialTheme.typography.bodyMedium, color = st.bad, fontWeight = FontWeight.Medium,
                        )
                        "short" -> Text(
                            "The test could not tell: the screen was off for only ${settings.testScreenOffMin} minutes. Lock the phone and leave it the whole time.",
                            style = MaterialTheme.typography.bodyMedium, color = st.warn, fontWeight = FontWeight.Medium,
                        )
                        else -> Text(
                            "Recommended. Start the test, lock the phone and leave it for 10 minutes. PayTrace then tells you whether the phone stopped it, which is what the settings above are for.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    Button(onClick = { StayAwake.start(settings) }, Modifier.fillMaxWidth()) {
                        Text(if (result.isEmpty()) "Start the 10-minute test" else "Test again")
                    }
                }
            }
        }
    }
}

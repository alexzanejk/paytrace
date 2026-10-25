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
import androidx.compose.material3.FilterChip
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
    var lang by remember { mutableStateOf(Lang.of(settings.guideLang)) }

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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = lang == Lang.BN, onClick = { lang = Lang.BN; settings.guideLang = Lang.BN.code }, label = { Text("বাংলা") })
            FilterChip(selected = lang == Lang.EN, onClick = { lang = Lang.EN; settings.guideLang = Lang.EN.code }, label = { Text("English") })
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                GuideText.progress(lang, finished, steps.size),
                style = MaterialTheme.typography.titleSmall,
                color = if (all) statusColors().ok else MaterialTheme.colorScheme.error,
            )
            LinearProgressIndicator(progress = { if (steps.isEmpty()) 1f else finished.toFloat() / steps.size }, Modifier.fillMaxWidth())
        }

        PhoneCheckCard(phone, lang)

        steps.forEachIndexed { index, step ->
            StepCard(
                index = index + 1,
                step = step,
                lang = lang,
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

        StayAwakeCard(settings, pulse, lang)

        Text(
            GuideText.footer(lang),
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
private fun PhoneCheckCard(lines: List<PhoneCheck.Line>, lang: Lang) {
    Card(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh),
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(GuideText.phoneCheckTitle(lang), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            lines.forEach { l ->
                Row(verticalAlignment = Alignment.Top) {
                    Box(Modifier.padding(top = 5.dp).size(10.dp).background(levelColor(l.level), CircleShape))
                    Column(Modifier.padding(start = 10.dp)) {
                        Text(l.title(lang), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        Text(l.answer(lang), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Text(
                GuideText.phoneCheckNote(lang),
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
    lang: Lang,
    ways: List<Way>,
    done: Boolean,
    verifiedByPhone: Boolean,
    onToggle: (Boolean) -> Unit,
) {
    val ctx = LocalContext.current
    val st = statusColors()
    var tried by remember(step.id) { mutableIntStateOf(-1) } // index of the page last opened; -1 = none yet
    val complete = done || verifiedByPhone
    val text = GuideText.step(step, lang)

    fun openFrom(from: Int) {
        val idx = SettingsOpener.openFrom(ctx, ways, from)
        tried = idx ?: -1
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
                Text(text.title, Modifier.padding(start = 12.dp), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Text("${GuideText.whereLabel(lang)} ${text.path}", style = MaterialTheme.typography.bodySmall)
            Text(
                "${GuideText.chooseLabel(lang)} ${text.choose}",
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            if (text.avoid != null) {
                Text("${GuideText.notLabel(lang)} ${text.avoid}", style = MaterialTheme.typography.bodySmall, color = st.bad)
            }
            Text(text.why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            if (step.open != Setup.Open.NONE) {
                if (tried < 0) {
                    Button(onClick = { openFrom(0) }, Modifier.fillMaxWidth()) { Text(GuideText.openThisPage(lang)) }
                } else {
                    Text("${GuideText.opened(lang)} ${GuideText.wayLabel(ways[tried], lang)}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    val last = tried + 1 >= ways.size
                    OutlinedButton(onClick = { openFrom(if (last) 0 else tried + 1) }, Modifier.fillMaxWidth()) {
                        Text(if (last) GuideText.startAgain(lang) else GuideText.tryAnother(lang))
                    }
                    if (ways[tried].id != SettingsWays.APP_INFO.id) {
                        TextButton(onClick = { SettingsOpener.start(ctx, SettingsWays.APP_INFO) }) { Text(GuideText.openAppPage(lang)) }
                    }
                }
            }

            when {
                verifiedByPhone -> Text(GuideText.phoneConfirms(lang), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = st.ok)
                done -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(GuideText.done(lang), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = st.ok)
                    TextButton(onClick = { onToggle(false) }) { Text(GuideText.undo(lang)) }
                }
                else -> OutlinedButton(onClick = { onToggle(true) }, Modifier.fillMaxWidth()) { Text(GuideText.iDidThis(lang)) }
            }
        }
    }
}

/** The proof: lock the phone for 10 minutes and see whether PayTrace kept running the whole time. */
@Composable
private fun StayAwakeCard(settings: AppSettings, pulse: Int, lang: Lang) {
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
            Text(GuideText.testTitle(lang), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            when {
                running -> {
                    Text(GuideText.testRunning(lang, StayAwake.minutesLeft(settings)), style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = { StayAwake.cancel(settings) }, Modifier.fillMaxWidth()) { Text(GuideText.testCancel(lang)) }
                }
                else -> {
                    when (result) {
                        "pass" -> Text(
                            GuideText.testPass(lang, at, settings.testScreenOffMin, settings.testResultGapS),
                            style = MaterialTheme.typography.bodyMedium, color = st.ok, fontWeight = FontWeight.Medium,
                        )
                        "fail" -> Text(
                            GuideText.testFail(lang, at, settings.testResultGapS),
                            style = MaterialTheme.typography.bodyMedium, color = st.bad, fontWeight = FontWeight.Medium,
                        )
                        "short" -> Text(
                            GuideText.testShort(lang, settings.testScreenOffMin),
                            style = MaterialTheme.typography.bodyMedium, color = st.warn, fontWeight = FontWeight.Medium,
                        )
                        else -> Text(GuideText.testIdle(lang), style = MaterialTheme.typography.bodyMedium)
                    }
                    Button(onClick = { StayAwake.start(settings) }, Modifier.fillMaxWidth()) {
                        Text(if (result.isEmpty()) GuideText.testStart(lang) else GuideText.testAgain(lang))
                    }
                }
            }
        }
    }
}

package com.paytrace.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/** The phone app's look (owner request 2026-10-24: simpler and clearer, dark like the reference, colours from the dashboard).
 *  Blue is the one accent, as in the dashboard; green, amber and red are used only for status. Dark is the default, light is a switch in
 *  Settings. Every screen reads colours from MaterialTheme, so nothing else needs to know about this. */
object ThemeState {
    /** Set from the saved setting when the app starts, and by the switch in Settings. */
    var dark by mutableStateOf(true)
}

private val Light = lightColorScheme(
    primary = Color(0xFF1565E8),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE1ECFF),
    onPrimaryContainer = Color(0xFF0B3C94),
    secondary = Color(0xFF52627A),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE6ECF4),
    onSecondaryContainer = Color(0xFF1B2638),
    tertiary = Color(0xFF8A5300),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFE8BF),
    onTertiaryContainer = Color(0xFF4A2B00),
    error = Color(0xFFD92D20),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDE3E0),
    onErrorContainer = Color(0xFF55120D),
    background = Color(0xFFEEF2F7),
    onBackground = Color(0xFF101828),
    surface = Color(0xFFEEF2F7),
    onSurface = Color(0xFF101828),
    surfaceVariant = Color(0xFFE3E9F1),
    onSurfaceVariant = Color(0xFF5B6678),
    outline = Color(0xFF8792A5),
    outlineVariant = Color(0xFFD3DBE6),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7F9FC),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceContainerHighest = Color(0xFFE6ECF4),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF6AA6FF),
    onPrimary = Color(0xFF04204D),
    primaryContainer = Color(0xFF17315E),
    onPrimaryContainer = Color(0xFFD9E8FF),
    secondary = Color(0xFFB9C7DC),
    onSecondary = Color(0xFF1E2A3B),
    secondaryContainer = Color(0xFF222C3A),
    onSecondaryContainer = Color(0xFFDCE6F4),
    tertiary = Color(0xFFFFB95C),
    onTertiary = Color(0xFF462A00),
    tertiaryContainer = Color(0xFF4A3410),
    onTertiaryContainer = Color(0xFFFFDDB0),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF5A1C18),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF0A0E14),
    onBackground = Color(0xFFE8EDF5),
    surface = Color(0xFF0A0E14),
    onSurface = Color(0xFFE8EDF5),
    surfaceVariant = Color(0xFF1F2733),
    onSurfaceVariant = Color(0xFF9AA6B8),
    outline = Color(0xFF627086),
    outlineVariant = Color(0xFF263040),
    surfaceContainerLowest = Color(0xFF070A0F),
    surfaceContainerLow = Color(0xFF10151C),
    surfaceContainer = Color(0xFF141B24),
    surfaceContainerHigh = Color(0xFF1A222D),
    surfaceContainerHighest = Color(0xFF222C39),
)

@Composable
fun PayTraceTheme(dark: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}

/** Status colours (green = good, amber = waiting, red = needs attention), each with a soft background, right for the current look. */
data class StatusColors(val ok: Color, val okBg: Color, val warn: Color, val warnBg: Color, val bad: Color, val badBg: Color)

@Composable
fun statusColors(): StatusColors =
    if (MaterialTheme.colorScheme.background.luminance() < 0.5f) {
        StatusColors(Color(0xFF6FDFAA), Color(0xFF11351F), Color(0xFFF0B35A), Color(0xFF3A2A10), Color(0xFFFFA39C), Color(0xFF45161A))
    } else {
        StatusColors(Color(0xFF0F7B4D), Color(0xFFDCF5E8), Color(0xFF8A5300), Color(0xFFFFECC7), Color(0xFFB3261E), Color(0xFFFDE3E0))
    }

/** The balance card's blue, the same family as the dashboard's blue tiles. */
fun balanceGradient(dark: Boolean): List<Color> =
    if (dark) listOf(Color(0xFF1B4FBF), Color(0xFF3D73E6)) else listOf(Color(0xFF1565E8), Color(0xFF4A86F2))

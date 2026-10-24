package com.paytrace.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The phone app's look (owner request 2026-10-24: cleaner, modern, green, light and dark). Light = soft cream with deep green; dark = near black
 *  with a bright green accent. Every screen reads colours from MaterialTheme, so nothing else needs to know about this. */
private val Light = lightColorScheme(
    primary = Color(0xFF1F7A35),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFCDEFA6),
    onPrimaryContainer = Color(0xFF10330F),
    secondary = Color(0xFF50634D),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFDDE8D2),
    onSecondaryContainer = Color(0xFF1B2E1A),
    tertiary = Color(0xFF8A5300),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFE2B8),
    onTertiaryContainer = Color(0xFF4A2B00),
    error = Color(0xFFB3261E),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF1F4E8),
    onBackground = Color(0xFF191D17),
    surface = Color(0xFFF1F4E8),
    onSurface = Color(0xFF191D17),
    surfaceVariant = Color(0xFFE1E8D6),
    onSurfaceVariant = Color(0xFF444D40),
    outline = Color(0xFF747D70),
    outlineVariant = Color(0xFFC4CCBA),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF7FAEF),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceContainerHighest = Color(0xFFE8EDDD),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF5BE37D),
    onPrimary = Color(0xFF04260F),
    primaryContainer = Color(0xFF173D22),
    onPrimaryContainer = Color(0xFFBDF7C9),
    secondary = Color(0xFFB4CCB0),
    onSecondary = Color(0xFF203420),
    secondaryContainer = Color(0xFF283128),
    onSecondaryContainer = Color(0xFFDCE7D8),
    tertiary = Color(0xFFFFB95C),
    onTertiary = Color(0xFF462A00),
    tertiaryContainer = Color(0xFF4A3410),
    onTertiaryContainer = Color(0xFFFFDDB0),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF5A1C18),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF0E100E),
    onBackground = Color(0xFFE6EAE3),
    surface = Color(0xFF0E100E),
    onSurface = Color(0xFFE6EAE3),
    surfaceVariant = Color(0xFF232823),
    onSurfaceVariant = Color(0xFFA9B2A5),
    outline = Color(0xFF6B7468),
    outlineVariant = Color(0xFF353B34),
    surfaceContainerLowest = Color(0xFF090A09),
    surfaceContainerLow = Color(0xFF141714),
    surfaceContainer = Color(0xFF181B18),
    surfaceContainerHigh = Color(0xFF1F231F),
    surfaceContainerHighest = Color(0xFF282D28),
)

@Composable
fun PayTraceTheme(dark: Boolean, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (dark) Dark else Light, content = content)
}

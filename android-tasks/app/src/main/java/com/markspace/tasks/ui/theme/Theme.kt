package com.markspace.tasks.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightScheme = lightColorScheme(
    primary = MsColors.Accent,
    onPrimary = Color.White,
    primaryContainer = MsColors.Accent.copy(alpha = 0.12f),
    onPrimaryContainer = MsColors.AccentStrong,
    secondary = MsColors.AccentStrong,
    background = MsColors.Bg,
    onBackground = MsColors.Text,
    surface = MsColors.Surface,
    onSurface = MsColors.Title,
    surfaceVariant = MsColors.BgElevated,
    onSurfaceVariant = MsColors.Meta,
    outline = MsColors.Divider,
    error = MsColors.Danger,
)

private val DarkScheme = darkColorScheme(
    primary = MsColors.Accent,
    onPrimary = Color.White,
    primaryContainer = MsColors.Accent.copy(alpha = 0.22f),
    onPrimaryContainer = Color.White,
    secondary = MsColors.Accent,
    background = MsColors.DarkBg,
    onBackground = MsColors.DarkText,
    surface = MsColors.DarkSurface,
    onSurface = MsColors.DarkText,
    surfaceVariant = MsColors.DarkBg,
    onSurfaceVariant = MsColors.DarkText.copy(alpha = 0.7f),
    outline = Color.White.copy(alpha = 0.08f),
    error = MsColors.Danger,
)

@Composable
fun MarkSpaceTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkScheme else LightScheme,
        typography = MsTypography,
        content = content,
    )
}

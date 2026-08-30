package com.markspace.tasks.ui.theme

import androidx.compose.ui.graphics.Color

/** MarkSpace / desktop Tasks tokens — mirror App.css + taskPriorities + pastelChipColors. */
object MsColors {
    val Accent = Color(0xFFCB11AB)
    val AccentStrong = Color(0xFFA00E89)
    val AccentRgb = Triple(203, 17, 171)

    val Bg = Color(0xFFF3F1EC)
    val BgElevated = Color(0xFFFAF8F4)
    val Surface = Color(0xFFFFFFFF)
    val Text = Color(0xFF1C2428)
    val Title = Color(0xFF202020)
    val Empty = Color(0xFF888888)
    val DoneTitle = Color(0xFF9A9A9A)
    val Divider = Color(0xFFF0F0F0)
    val CircleDefault = Color(0xFFB8B8B8)
    val CircleHover = Color(0xFF808080)
    val Meta = Color(0xFF888888)
    val MenuHover = Color(0xFFF0EEEA)
    val Danger = Color(0xFFC62828)

    // Dark tokens (ready for later)
    val DarkBg = Color(0xFF12181C)
    val DarkSurface = Color(0xFF1E1E1E)
    val DarkText = Color(0xFFE7EEF2)
}

data class PrioritySwatch(
    val value: Int?,
    val label: String,
    val color: Color,
    val chipBg: Color,
    val chipBgHover: Color,
    val chipBorder: Color,
)

val PriorityOptions = listOf(
    PrioritySwatch(1, "Do", Color(0xFFE53935), Color(0xFFFDECEA), Color(0xFFFADBD8), Color(0xFFF5C6C2)),
    PrioritySwatch(2, "Schedule", Color(0xFFFB8C00), Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFFFCC80)),
    PrioritySwatch(3, "Delegate", Color(0xFFF9A825), Color(0xFFFFF8E1), Color(0xFFFFECB3), Color(0xFFFFE082)),
    PrioritySwatch(4, "Postponed", Color(0xFF42A5F5), Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFF90CAF9)),
)

val PriorityNone = PrioritySwatch(
    null,
    "None",
    Color(0xFF9E9E9E),
    Color.Transparent,
    Color.Transparent,
    Color.Transparent,
)

fun prioritySwatch(priority: Int?): PrioritySwatch =
    PriorityOptions.firstOrNull { it.value == priority } ?: PriorityNone

data class PastelSwatch(
    val bg: Color,
    val bgHover: Color,
    val border: Color,
    val text: Color,
)

val PastelChipSwatches = listOf(
    PastelSwatch(Color(0xFFFFEBEF), Color(0xFFFFCDD2), Color(0xFFEF9A9A), Color(0xFFC62828)),
    PastelSwatch(Color(0xFFFCE4EC), Color(0xFFF8BBD0), Color(0xFFF48FB1), Color(0xFFAD1457)),
    PastelSwatch(Color(0xFFF3E5F5), Color(0xFFE1BEE7), Color(0xFFCE93D8), Color(0xFF6A1B9A)),
    PastelSwatch(Color(0xFFEDE7F6), Color(0xFFD1C4E9), Color(0xFFB39DDB), Color(0xFF4527A0)),
    PastelSwatch(Color(0xFFE8EAF6), Color(0xFFC5CAE9), Color(0xFF9FA8DA), Color(0xFF283593)),
    PastelSwatch(Color(0xFFE3F2FD), Color(0xFFBBDEFB), Color(0xFF90CAF9), Color(0xFF1565C0)),
    PastelSwatch(Color(0xFFE1F5FE), Color(0xFFB3E5FC), Color(0xFF81D4FA), Color(0xFF0277BD)),
    PastelSwatch(Color(0xFFE0F7FA), Color(0xFFB2EBF2), Color(0xFF80DEEA), Color(0xFF00838F)),
    PastelSwatch(Color(0xFFE0F2F1), Color(0xFFB2DFDB), Color(0xFF80CBC4), Color(0xFF00695C)),
    PastelSwatch(Color(0xFFE8F5E9), Color(0xFFC8E6C9), Color(0xFFA5D6A7), Color(0xFF2E7D32)),
    PastelSwatch(Color(0xFFF1F8E9), Color(0xFFDCEDC8), Color(0xFFC5E1A5), Color(0xFF558B2F)),
    PastelSwatch(Color(0xFFF9FBE7), Color(0xFFF0F4C3), Color(0xFFE6EE9C), Color(0xFF9E9D24)),
    PastelSwatch(Color(0xFFFFF8E1), Color(0xFFFFECB3), Color(0xFFFFE082), Color(0xFFFF8F00)),
    PastelSwatch(Color(0xFFFFF3E0), Color(0xFFFFE0B2), Color(0xFFFFCC80), Color(0xFFEF6C00)),
    PastelSwatch(Color(0xFFFBE9E7), Color(0xFFFFCCBC), Color(0xFFFFAB91), Color(0xFFD84315)),
    PastelSwatch(Color(0xFFEFEBE9), Color(0xFFD7CCC8), Color(0xFFBCAAA4), Color(0xFF5D4037)),
    PastelSwatch(Color(0xFFECEFF1), Color(0xFFCFD8DC), Color(0xFFB0BEC5), Color(0xFF455A64)),
)

fun pastelForName(name: String): PastelSwatch {
    var h = 0
    val s = name.trim().lowercase()
    for (ch in s) {
        h = h * 31 + ch.code
    }
    val i = (h.toUInt() % PastelChipSwatches.size.toUInt()).toInt()
    return PastelChipSwatches[i]
}

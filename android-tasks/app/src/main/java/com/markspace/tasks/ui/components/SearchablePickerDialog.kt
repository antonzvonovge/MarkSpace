package com.markspace.tasks.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography

data class PickerOption(
    val value: String,
    val label: String,
)

/**
 * Inline searchable list picker (works inside ModalBottomSheet —
 * AlertDialog often fails to appear when nested there).
 */
@Composable
fun SearchableListPicker(
    title: String,
    options: List<PickerOption>,
    selected: String,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (String) -> Unit,
    searchPlaceholder: String = "Filter…",
    chipLabel: String = selected.ifEmpty { title },
    chipTint: androidx.compose.ui.graphics.Color? = null,
    chipBg: androidx.compose.ui.graphics.Color? = null,
) {
    var query by remember(expanded) { mutableStateOf("") }
    val filtered = remember(query, options) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) options
        else options.filter { it.label.lowercase().contains(q) }
    }
    val colors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MsColors.Accent,
        cursorColor = MsColors.Accent,
    )

    Column(modifier = Modifier.fillMaxWidth()) {
        SoftChipWithChevron(
            label = chipLabel,
            expanded = expanded,
            tint = chipTint,
            bg = chipBg,
            onClick = { onExpandedChange(!expanded) },
        )
        if (expanded) {
            Spacer(Modifier.height(8.dp))
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MsColors.BgElevated, RoundedCornerShape(8.dp))
                    .border(1.dp, MsColors.Divider, RoundedCornerShape(8.dp))
                    .padding(8.dp),
            ) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(searchPlaceholder) },
                    singleLine = true,
                    leadingIcon = {
                        Icon(Icons.Default.Search, contentDescription = null, tint = MsColors.Meta)
                    },
                    colors = colors,
                )
                Spacer(Modifier.height(4.dp))
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 220.dp),
                ) {
                    items(filtered, key = { it.value.ifEmpty { "__empty__" } }) { opt ->
                        val isSelected = opt.value == selected
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onSelect(opt.value)
                                    onExpandedChange(false)
                                    query = ""
                                }
                                .background(
                                    if (isSelected) MsColors.Accent.copy(alpha = 0.1f)
                                    else androidx.compose.ui.graphics.Color.Transparent,
                                    RoundedCornerShape(6.dp),
                                )
                                .padding(horizontal = 10.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(
                                opt.label,
                                style = MsTypography.bodyLarge.copy(
                                    color = if (isSelected) MsColors.Accent else MsColors.Title,
                                ),
                            )
                            if (isSelected) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = null,
                                    tint = MsColors.Accent,
                                )
                            }
                        }
                    }
                    if (filtered.isEmpty()) {
                        item {
                            Text(
                                "No matches",
                                style = MsTypography.bodyMedium.copy(color = MsColors.Empty),
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

/** Legacy dialog API — prefer [SearchableListPicker] inside sheets. */
@Composable
fun SearchablePickerDialog(
    title: String,
    options: List<PickerOption>,
    selected: String,
    onDismiss: () -> Unit,
    onSelect: (String) -> Unit,
    searchPlaceholder: String = "Search",
) {
    // Keep for Filters bar: render as always-expanded inline panel in a simple column dialog substitute
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MsColors.Surface,
        title = { Text(title, style = MsTypography.titleMedium) },
        text = {
            var query by remember { mutableStateOf("") }
            val filtered = remember(query, options) {
                val q = query.trim().lowercase()
                if (q.isEmpty()) options
                else options.filter { it.label.lowercase().contains(q) }
            }
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text(searchPlaceholder) },
                    singleLine = true,
                    leadingIcon = {
                        Icon(Icons.Default.Search, null, tint = MsColors.Meta)
                    },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MsColors.Accent,
                        cursorColor = MsColors.Accent,
                    ),
                )
                LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp)) {
                    items(filtered, key = { it.value.ifEmpty { "__empty__" } }) { opt ->
                        Text(
                            text = opt.label,
                            style = MsTypography.bodyLarge.copy(
                                color = if (opt.value == selected) MsColors.Accent else MsColors.Title,
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onSelect(opt.value)
                                    onDismiss()
                                }
                                .padding(horizontal = 4.dp, vertical = 12.dp),
                        )
                    }
                }
            }
        },
        confirmButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Close") }
        },
    )
}

@Composable
fun SoftChipWithChevron(
    label: String,
    onClick: () -> Unit,
    expanded: Boolean = false,
    tint: androidx.compose.ui.graphics.Color? = null,
    bg: androidx.compose.ui.graphics.Color? = null,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .background(bg ?: MsColors.BgElevated, RoundedCornerShape(6.dp))
            .border(1.dp, MsColors.Divider, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(
            text = label,
            style = MsTypography.labelLarge.copy(color = tint ?: MsColors.Title),
        )
        Icon(
            if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
            contentDescription = null,
            tint = tint ?: MsColors.Meta,
            modifier = Modifier.padding(start = 2.dp),
        )
    }
}

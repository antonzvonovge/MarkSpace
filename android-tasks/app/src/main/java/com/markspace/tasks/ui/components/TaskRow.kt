package com.markspace.tasks.ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.markspace.tasknotes.TaskIndexEntry
import com.markspace.tasknotes.formatTaskDueLabel
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography
import com.markspace.tasks.ui.theme.pastelForName
import com.markspace.tasks.ui.theme.prioritySwatch
import androidx.compose.foundation.background

@Composable
fun TaskCircle(
    checked: Boolean,
    priority: Int?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val swatch = prioritySwatch(priority)
    val borderColor = when {
        checked && priority != null -> swatch.color
        checked -> MsColors.CircleDefault
        priority != null -> swatch.color
        else -> MsColors.CircleDefault
    }
    val fill = if (checked) borderColor else Color.Transparent
    Box(
        modifier = Modifier
            .size(18.dp)
            .clip(CircleShape)
            .border(1.5.dp, borderColor, CircleShape)
            .background(fill, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) {
            Icon(
                Icons.Default.Check,
                contentDescription = "Done",
                tint = Color.White,
                modifier = Modifier.size(12.dp),
            )
        }
    }
}

@Composable
fun LabelChip(name: String, modifier: Modifier = Modifier) {
    val s = pastelForName(name)
    Text(
        text = name,
        style = MsTypography.labelSmall.copy(color = s.text),
        modifier = Modifier
            .background(s.bg, RoundedCornerShape(4.dp))
            .border(1.dp, s.border, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun PriorityChip(priority: Int?, modifier: Modifier = Modifier) {
    val s = prioritySwatch(priority)
    if (priority == null) return
    Text(
        text = s.label,
        style = MsTypography.labelSmall.copy(color = s.color),
        modifier = Modifier
            .background(s.chipBg, RoundedCornerShape(4.dp))
            .border(1.dp, s.chipBorder, RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
fun TaskRow(
    entry: TaskIndexEntry,
    depth: Int,
    selected: Boolean,
    onToggle: () -> Unit,
    onClick: () -> Unit,
) {
    val done = entry.status == "done"
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) MsColors.Accent.copy(alpha = 0.06f) else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(start = (12 + depth * 20).dp, end = 12.dp, top = 8.dp, bottom = 8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TaskCircle(checked = done, priority = entry.priority, onClick = onToggle)
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.title,
                    style = MsTypography.bodyLarge.copy(
                        color = if (done) MsColors.DoneTitle else MsColors.Title,
                        textDecoration = if (done) TextDecoration.LineThrough else TextDecoration.None,
                    ),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                val due = formatTaskDueLabel(entry.due)
                val metaParts = buildList {
                    due?.let { add(it) }
                    if (entry.subtaskTotal > 0) add("${entry.subtaskDone}/${entry.subtaskTotal}")
                    if (entry.commentCount > 0) add("${entry.commentCount} comments")
                }
                if (metaParts.isNotEmpty() || entry.labels.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (metaParts.isNotEmpty()) {
                            Text(metaParts.joinToString(" · "), style = MsTypography.labelSmall)
                        }
                        entry.labels.take(3).forEach { LabelChip(it) }
                    }
                }
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 28.dp, top = 8.dp)
                .height(1.dp)
                .background(MsColors.Divider),
        )
    }
}

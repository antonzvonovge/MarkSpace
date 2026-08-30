package com.markspace.tasks.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography
import com.markspace.tasks.ui.theme.PriorityNone
import com.markspace.tasks.ui.theme.PriorityOptions
import com.markspace.tasks.ui.theme.pastelForName
import com.markspace.tasks.ui.theme.prioritySwatch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.delay

/**
 * Desktop-matched task composer:
 * title field + chip bar (list / due / priority / labels) + submit.
 * Cancel via sheet dismiss / swipe — no X button.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
@Suppress("UNUSED_PARAMETER")
fun TasksComposer(
    lists: List<String>,
    defaultList: String,
    labelCatalog: List<String>,
    onCancel: () -> Unit, // dismiss via sheet swipe
    onCreate: (title: String, list: String, due: String?, priority: Int?, labels: List<String>) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var list by remember { mutableStateOf(defaultList.ifEmpty { "Inbox" }) }
    var due by remember { mutableStateOf<String?>(null) }
    var priority by remember { mutableStateOf<Int?>(null) }
    var labels by remember { mutableStateOf<List<String>>(emptyList()) }
    var listPicker by remember { mutableStateOf(false) }
    var priorityMenu by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    val titleFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    // Bottom sheet needs a beat before focus sticks and IME shows.
    LaunchedEffect(Unit) {
        delay(280)
        runCatching {
            titleFocus.requestFocus()
            keyboard?.show()
        }
    }

    fun submit() {
        onCreate(
            title.trim().ifEmpty { "Untitled" },
            list,
            due,
            priority,
            labels,
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .border(1.dp, MsColors.Divider, RoundedCornerShape(12.dp))
            .background(MsColors.Surface, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp),
    ) {
        BasicTextField(
            value = title,
            onValueChange = { title = it },
            singleLine = true,
            textStyle = TextStyle(
                fontSize = 16.sp,
                lineHeight = 22.sp,
                color = MsColors.Title,
                fontWeight = FontWeight.Normal,
            ),
            cursorBrush = SolidColor(MsColors.Accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(titleFocus)
                .padding(vertical = 4.dp),
            decorationBox = { inner ->
                Box {
                    if (title.isEmpty()) {
                        Text(
                            "Task name",
                            style = TextStyle(fontSize = 16.sp, color = MsColors.Meta),
                        )
                    }
                    inner()
                }
            },
        )

        Spacer(Modifier.height(10.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ComposerCtrl(
                    label = list,
                    onClick = {
                        listPicker = !listPicker
                        priorityMenu = false
                        showDatePicker = false
                    },
                )
                ComposerCtrl(
                    label = due ?: "Due",
                    onClick = {
                        showDatePicker = true
                        listPicker = false
                        priorityMenu = false
                    },
                )
                Box {
                    val sw = prioritySwatch(priority)
                    ComposerCtrl(
                        label = sw.label,
                        tint = if (priority != null) sw.color else null,
                        filled = priority != null,
                        fillBg = if (priority != null) sw.chipBg else null,
                        fillBorder = if (priority != null) sw.chipBorder else null,
                        onClick = {
                            priorityMenu = true
                            listPicker = false
                        },
                    )
                    DropdownMenu(
                        expanded = priorityMenu,
                        onDismissRequest = { priorityMenu = false },
                    ) {
                        (listOf(PriorityNone) + PriorityOptions).forEach { opt ->
                            DropdownMenuItem(
                                text = { Text(opt.label, color = opt.color) },
                                onClick = {
                                    priority = opt.value
                                    priorityMenu = false
                                },
                            )
                        }
                    }
                }
                InlineLabelsField(
                    labels = labels,
                    catalog = labelCatalog,
                    onChange = { labels = it },
                    onEmptyEnter = { submit() },
                )
            }

            IconButton(
                onClick = { submit() },
                modifier = Modifier
                    .padding(start = 6.dp)
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MsColors.Accent),
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Save",
                    tint = Color.White,
                    modifier = Modifier.size(22.dp),
                )
            }
        }

        if (listPicker) {
            Spacer(Modifier.height(8.dp))
            InlineSearchList(
                options = lists.map { PickerOption(it, it) },
                selected = list,
                searchPlaceholder = "Filter lists…",
                onSelect = {
                    list = it
                    listPicker = false
                    // Return caret to the title after picking a list.
                    runCatching {
                        titleFocus.requestFocus()
                        keyboard?.show()
                    }
                },
            )
        }
    }

    if (showDatePicker) {
        val initialMillis = due?.let { ymdToUtcMillis(it) }
        val dateState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(
                    onClick = {
                        due = dateState.selectedDateMillis?.let { utcMillisToYmd(it) }
                        showDatePicker = false
                    },
                ) { Text("OK") }
            },
            dismissButton = {
                Row {
                    if (due != null) {
                        TextButton(onClick = {
                            due = null
                            showDatePicker = false
                        }) { Text("Clear") }
                    }
                    TextButton(onClick = { showDatePicker = false }) { Text("Cancel") }
                }
            },
        ) {
            DatePicker(state = dateState)
        }
    }
}

/** Tappable composer control — min ~40dp height for fingers. */
@Composable
fun ComposerCtrl(
    label: String,
    onClick: () -> Unit,
    tint: Color? = null,
    filled: Boolean = false,
    fillBg: Color? = null,
    fillBorder: Color? = null,
) {
    val shape = RoundedCornerShape(8.dp)
    Text(
        text = label,
        style = TextStyle(
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            lineHeight = 18.sp,
            color = tint ?: MsColors.Title,
        ),
        maxLines = 1,
        modifier = Modifier
            .heightIn(min = 40.dp)
            .clip(shape)
            .background(fillBg ?: MsColors.BgElevated)
            .border(1.dp, fillBorder ?: MsColors.Divider, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .widthIn(max = 180.dp),
    )
}

@Composable
private fun InlineSearchList(
    options: List<PickerOption>,
    selected: String,
    searchPlaceholder: String,
    onSelect: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val searchFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val filtered = remember(query, options) {
        val q = query.trim().lowercase()
        if (q.isEmpty()) options else options.filter { it.label.lowercase().contains(q) }
    }

    LaunchedEffect(Unit) {
        delay(50)
        runCatching {
            searchFocus.requestFocus()
            keyboard?.show()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MsColors.BgElevated, RoundedCornerShape(8.dp))
            .border(1.dp, MsColors.Divider, RoundedCornerShape(8.dp))
            .padding(6.dp),
    ) {
        BasicTextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            textStyle = MsTypography.bodyMedium.copy(color = MsColors.Title),
            cursorBrush = SolidColor(MsColors.Accent),
            modifier = Modifier
                .fillMaxWidth()
                .focusRequester(searchFocus)
                .padding(horizontal = 8.dp, vertical = 8.dp),
            decorationBox = { inner ->
                Box {
                    if (query.isEmpty()) {
                        Text(searchPlaceholder, style = MsTypography.bodyMedium)
                    }
                    inner()
                }
            },
        )
        Column(modifier = Modifier.heightIn(max = 200.dp)) {
            filtered.forEach { opt ->
                val isSel = opt.value == selected
                Text(
                    opt.label,
                    style = MsTypography.bodyLarge.copy(
                        color = if (isSel) MsColors.Accent else MsColors.Title,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(opt.value) }
                        .background(
                            if (isSel) MsColors.Accent.copy(alpha = 0.1f) else Color.Transparent,
                        )
                        .padding(horizontal = 10.dp, vertical = 10.dp),
                )
            }
            if (filtered.isEmpty()) {
                Text(
                    "No matches",
                    style = MsTypography.bodyMedium,
                    modifier = Modifier.padding(10.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InlineLabelsField(
    labels: List<String>,
    catalog: List<String>,
    onChange: (List<String>) -> Unit,
    onEmptyEnter: () -> Unit = {},
) {
    var draft by remember { mutableStateOf("") }
    var suggestOpen by remember { mutableStateOf(false) }
    val suggestions = remember(draft, catalog, labels) {
        val q = draft.trim().lowercase()
        if (q.isEmpty()) emptyList()
        else catalog.filter {
            it.lowercase().contains(q) && labels.none { have -> have.equals(it, ignoreCase = true) }
        }.take(6)
    }

    fun commit(raw: String): Boolean {
        val name = raw.trim().trimStart('#').trim()
        if (name.isEmpty()) return false
        if (labels.any { it.equals(name, ignoreCase = true) }) {
            draft = ""
            return true
        }
        onChange(labels + name)
        draft = ""
        suggestOpen = false
        return true
    }

    Box {
        val labelShape = RoundedCornerShape(8.dp)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier
                .heightIn(min = 40.dp)
                .clip(labelShape)
                .background(MsColors.BgElevated)
                .border(1.dp, MsColors.Divider, labelShape)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            labels.forEach { name ->
                val s = pastelForName(name)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .background(s.bg, RoundedCornerShape(6.dp))
                        .border(1.dp, s.border, RoundedCornerShape(6.dp))
                        .padding(start = 8.dp, end = 2.dp, top = 2.dp, bottom = 2.dp),
                ) {
                    Text(
                        name,
                        style = TextStyle(fontSize = 13.sp, color = s.text),
                        maxLines = 1,
                    )
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Remove",
                        tint = s.text,
                        modifier = Modifier
                            .size(16.dp)
                            .clickable {
                                onChange(labels.filterNot { it.equals(name, ignoreCase = true) })
                            },
                    )
                }
            }
            BasicTextField(
                value = draft,
                onValueChange = {
                    draft = it
                    suggestOpen = it.isNotBlank()
                    if (it.endsWith(",") || it.endsWith(" ")) {
                        commit(it.dropLast(1))
                    }
                },
                singleLine = true,
                textStyle = TextStyle(fontSize = 14.sp, color = MsColors.Title),
                cursorBrush = SolidColor(MsColors.Accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(
                    onDone = {
                        if (draft.isBlank()) onEmptyEnter() else commit(draft)
                    },
                ),
                modifier = Modifier.widthIn(min = 64.dp, max = 140.dp),
                decorationBox = { inner ->
                    Box {
                        if (draft.isEmpty() && labels.isEmpty()) {
                            Text(
                                "Labels",
                                style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MsColors.Title),
                            )
                        }
                        inner()
                    }
                },
            )
        }
        if (suggestOpen && suggestions.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .padding(top = 44.dp)
                    .widthIn(min = 160.dp)
                    .background(MsColors.Surface, RoundedCornerShape(8.dp))
                    .border(1.dp, MsColors.Divider, RoundedCornerShape(8.dp)),
            ) {
                suggestions.forEach { name ->
                    Text(
                        name,
                        style = MsTypography.bodyMedium.copy(color = MsColors.Title),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { commit(name) }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}

/** Kept for Filters bar and other screens. */
@Composable
fun SoftChip(
    label: String,
    onClick: () -> Unit,
    tint: Color? = null,
    bg: Color? = null,
) {
    Text(
        text = label,
        style = MsTypography.labelLarge.copy(color = tint ?: MsColors.Title),
        modifier = Modifier
            .background(bg ?: MsColors.BgElevated, RoundedCornerShape(6.dp))
            .border(1.dp, MsColors.Divider, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
    )
}

/** Legacy label block (detail screen etc.). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LabelChipsInput(
    labels: List<String>,
    catalog: List<String>,
    onChange: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    InlineLabelsField(labels, catalog, onChange)
}

private val YmdFmt: DateTimeFormatter = DateTimeFormatter.ISO_LOCAL_DATE

fun ymdToUtcMillis(ymd: String): Long? =
    runCatching {
        LocalDate.parse(ymd, YmdFmt).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
    }.getOrNull()

fun utcMillisToYmd(millis: Long): String =
    Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate().format(YmdFmt)

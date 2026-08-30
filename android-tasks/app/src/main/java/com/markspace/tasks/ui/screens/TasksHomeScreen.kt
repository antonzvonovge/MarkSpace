package com.markspace.tasks.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.markspace.tasknotes.TaskIndexEntry
import com.markspace.tasknotes.TasksFilters
import com.markspace.tasknotes.TasksViewId
import com.markspace.tasks.data.TasksUiState
import com.markspace.tasks.ui.components.PickerOption
import com.markspace.tasks.ui.components.SearchablePickerDialog
import com.markspace.tasks.ui.components.SoftChip
import com.markspace.tasks.ui.components.TaskRow
import com.markspace.tasks.ui.components.TasksComposer
import com.markspace.tasks.ui.theme.MsColors
import com.markspace.tasks.ui.theme.MsTypography
import com.markspace.tasks.ui.theme.PriorityOptions
import com.markspace.tasks.ui.theme.prioritySwatch
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TasksHomeScreen(
    state: TasksUiState,
    rows: List<Pair<TaskIndexEntry, Int>>,
    onOpenDrawerList: (String) -> Unit,
    onSetView: (TasksViewId) -> Unit,
    onFilters: (TasksFilters) -> Unit,
    onToggle: (path: String, done: Boolean) -> Unit,
    onSelect: (String) -> Unit,
    onOpenComposer: (Boolean) -> Unit,
    onCreate: (title: String, list: String, due: String?, priority: Int?, labels: List<String>) -> Unit,
    onOpenSync: () -> Unit,
    onCreateList: (String) -> Unit,
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    var newListName by remember { mutableStateOf("") }

    val title = when (state.view) {
        TasksViewId.Inbox -> "Inbox"
        TasksViewId.Today -> "Today"
        TasksViewId.Upcoming -> "Today"
        TasksViewId.Filters -> "Filters"
        TasksViewId.All -> state.filters.list.ifEmpty { "All" }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(drawerContainerColor = MsColors.Bg) {
                Text(
                    "MarkSpace Tasks",
                    style = MsTypography.titleMedium.copy(color = MsColors.AccentStrong),
                    modifier = Modifier.padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 12.dp),
                )
                state.lists.forEach { name ->
                    val selected = state.view == TasksViewId.All && state.filters.list == name
                    Text(
                        text = name,
                        style = MsTypography.bodyLarge.copy(
                            color = if (selected) MsColors.Accent else MsColors.Title,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(if (selected) MsColors.Accent.copy(alpha = 0.1f) else MsColors.Bg)
                            .clickable {
                                onOpenDrawerList(name)
                                scope.launch { drawerState.close() }
                            }
                            .padding(horizontal = 20.dp, vertical = 12.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = newListName,
                        onValueChange = { newListName = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("New list") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MsColors.Accent),
                    )
                    Spacer(Modifier.width(8.dp))
                    IconButton(
                        onClick = {
                            if (newListName.isNotBlank()) {
                                onCreateList(newListName.trim())
                                newListName = ""
                            }
                        },
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Add list", tint = MsColors.Accent)
                    }
                }
            }
        },
    ) {
        Scaffold(
            containerColor = MsColors.Surface,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                TopAppBar(
                    title = { Text(title, style = MsTypography.headlineMedium) },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(Icons.Default.Menu, contentDescription = "Lists")
                        }
                    },
                    actions = {
                        IconButton(onClick = onOpenSync) {
                            Icon(
                                if (state.syncStatus.dirty || state.syncBusy) Icons.Default.Sync else Icons.Default.Settings,
                                contentDescription = "Sync",
                                tint = MsColors.Accent,
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MsColors.Surface),
                )
            },
            bottomBar = {
                NavigationBar(containerColor = MsColors.BgElevated) {
                    NavItem(Icons.Default.Inbox, "Inbox", state.view == TasksViewId.Inbox) {
                        onSetView(TasksViewId.Inbox)
                    }
                    NavItem(Icons.Default.Today, "Today", state.view == TasksViewId.Today) {
                        onSetView(TasksViewId.Today)
                    }
                    NavItem(Icons.Default.FilterList, "Filters", state.view == TasksViewId.Filters) {
                        onSetView(TasksViewId.Filters)
                    }
                }
            },
            floatingActionButton = {
                FloatingActionButton(
                    onClick = { onOpenComposer(true) },
                    containerColor = MsColors.Accent,
                    contentColor = androidx.compose.ui.graphics.Color.White,
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Add task")
                }
            },
        ) { padding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .background(MsColors.Surface),
            ) {
                if (state.view == TasksViewId.Filters) {
                    DesktopStyleFiltersBar(
                        filters = state.filters,
                        lists = state.lists,
                        labelCatalog = state.labelCatalog,
                        onFilters = onFilters,
                    )
                }
                if (rows.isEmpty()) {
                    Text(
                        "No tasks",
                        style = MsTypography.bodyMedium.copy(color = MsColors.Empty),
                        modifier = Modifier.padding(start = 54.dp, top = 24.dp),
                    )
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(rows, key = { it.first.path }) { (entry, depth) ->
                            TaskRow(
                                entry = entry,
                                depth = depth,
                                selected = state.selectedPath == entry.path,
                                onToggle = { onToggle(entry.path, entry.status == "done") },
                                onClick = { onSelect(entry.path) },
                            )
                        }
                    }
                }
            }
        }
    }

    if (state.composerOpen) {
        ModalBottomSheet(
            onDismissRequest = { onOpenComposer(false) },
            containerColor = MsColors.Surface,
        ) {
            val defaultList = when {
                state.view == TasksViewId.All && state.filters.list.isNotEmpty() -> state.filters.list
                state.view == TasksViewId.Inbox -> "Inbox"
                else -> "Inbox"
            }
            TasksComposer(
                lists = state.lists,
                defaultList = defaultList,
                labelCatalog = state.labelCatalog,
                onCancel = { onOpenComposer(false) },
                onCreate = onCreate,
            )
        }
    }
}

@Composable
private fun RowScope.NavItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label) },
        colors = NavigationBarItemDefaults.colors(
            selectedIconColor = MsColors.Accent,
            selectedTextColor = MsColors.Accent,
            indicatorColor = MsColors.Accent.copy(alpha = 0.12f),
            unselectedIconColor = MsColors.Meta,
            unselectedTextColor = MsColors.Meta,
        ),
    )
}

/** Mirrors desktop Filters: Project / Priority / Label / Status. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DesktopStyleFiltersBar(
    filters: TasksFilters,
    lists: List<String>,
    labelCatalog: List<String>,
    onFilters: (TasksFilters) -> Unit,
) {
    var projectPicker by remember { mutableStateOf(false) }
    var priorityPicker by remember { mutableStateOf(false) }
    var labelPicker by remember { mutableStateOf(false) }
    var statusPicker by remember { mutableStateOf(false) }

    val projectLabel = when {
        filters.list.isEmpty() -> "Any project"
        else -> filters.list
    }
    val priorityLabel = when (filters.priority) {
        null -> "Any priority"
        else -> prioritySwatch(filters.priority).label
    }
    val labelLabel = when {
        filters.label.isEmpty() -> "Any label"
        else -> filters.label
    }
    val statusLabel = when (filters.status) {
        "done" -> "Done"
        "all" -> "All statuses"
        else -> "Open"
    }

    FlowRow(
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SoftChip(label = projectLabel, onClick = { projectPicker = true })
        SoftChip(
            label = priorityLabel,
            tint = filters.priority?.let { prioritySwatch(it).color },
            bg = filters.priority?.let { prioritySwatch(it).chipBg },
            onClick = { priorityPicker = true },
        )
        SoftChip(label = labelLabel, onClick = { labelPicker = true })
        SoftChip(label = statusLabel, onClick = { statusPicker = true })
    }

    if (projectPicker) {
        SearchablePickerDialog(
            title = "Project",
            options = listOf(PickerOption("", "Any project"), PickerOption("Inbox", "Inbox")) +
                lists.filter { it != "Inbox" }.map { PickerOption(it, it) },
            selected = filters.list,
            onDismiss = { projectPicker = false },
            onSelect = { onFilters(filters.copy(list = it)) },
            searchPlaceholder = "Search projects",
        )
    }
    if (priorityPicker) {
        SearchablePickerDialog(
            title = "Priority",
            options = listOf(PickerOption("", "Any priority")) +
                PriorityOptions.map { PickerOption(it.value.toString(), it.label) },
            selected = filters.priority?.toString().orEmpty(),
            onDismiss = { priorityPicker = false },
            onSelect = { v ->
                onFilters(
                    filters.copy(
                        priority = v.toIntOrNull()?.takeIf { it in 1..4 },
                    ),
                )
            },
        )
    }
    if (labelPicker) {
        SearchablePickerDialog(
            title = "Label",
            options = listOf(PickerOption("", "Any label")) +
                labelCatalog.map { PickerOption(it, it) },
            selected = filters.label,
            onDismiss = { labelPicker = false },
            onSelect = { onFilters(filters.copy(label = it)) },
            searchPlaceholder = "Search labels",
        )
    }
    if (statusPicker) {
        SearchablePickerDialog(
            title = "Status",
            options = listOf(
                PickerOption("open", "Open"),
                PickerOption("done", "Done"),
                PickerOption("all", "All statuses"),
            ),
            selected = filters.status,
            onDismiss = { statusPicker = false },
            onSelect = { onFilters(filters.copy(status = it)) },
        )
    }
}

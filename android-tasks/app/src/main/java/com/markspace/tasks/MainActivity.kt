package com.markspace.tasks

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.markspace.tasks.data.TasksUiState
import com.markspace.tasks.data.TasksViewModel
import com.markspace.tasks.ui.screens.SyncSettingsScreen
import com.markspace.tasks.ui.screens.TaskDetailScreen
import com.markspace.tasks.ui.screens.TasksHomeScreen
import com.markspace.tasks.ui.theme.MarkSpaceTheme
import com.markspace.tasks.ui.theme.MsColors

class MainActivity : ComponentActivity() {
    private val vm: TasksViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Android 15+ may still draw edge-to-edge even with decorFits=true;
        // Compose safeDrawingPadding keeps content clear of status/nav/cutout.
        WindowCompat.setDecorFitsSystemWindows(window, true)
        setContent {
            MarkSpaceTheme(darkTheme = false) {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .safeDrawingPadding(),
                    color = MsColors.Bg,
                ) {
                    val state by vm.state.collectAsStateWithLifecycle()
                    ResumeSyncEffect(vm)
                    AppNav(vm, state)
                }
            }
        }
    }
}

@Composable
private fun ResumeSyncEffect(vm: TasksViewModel) {
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) vm.onResumeSync()
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
}

private enum class Screen { Home, Sync, Detail }

@Composable
private fun AppNav(vm: TasksViewModel, state: TasksUiState) {
    var screen by remember { mutableStateOf(Screen.Home) }

    when {
        state.needsOnboarding || screen == Screen.Sync -> {
            SyncSettingsScreen(
                prefs = state.syncPrefs,
                status = state.syncStatus,
                busy = state.syncBusy,
                message = state.syncMessage,
                error = state.error,
                onboarding = state.needsOnboarding,
                onSave = vm::saveSyncPrefs,
                onClone = vm::cloneOrConnect,
                onLocalVault = vm::createLocalVault,
                onSyncNow = vm::syncNow,
                onResolve = vm::resolveConflict,
                onBack = if (!state.needsOnboarding) ({ screen = Screen.Home }) else null,
            )
        }
        screen == Screen.Detail && state.selectedNote != null -> {
            val note = state.selectedNote!!
            TaskDetailScreen(
                note = note,
                vaultRoot = vm.vaultDir(),
                onBack = {
                    screen = Screen.Home
                    vm.selectTask(null)
                },
                onToggle = {
                    vm.toggleStatus(note.path, note.attrs.status == "done")
                },
                onSave = { title, due, clearDue, priority, clearPriority, labels, status ->
                    vm.saveSelected(title, due, clearDue, priority, clearPriority, labels, status)
                },
                onComment = vm::appendComment,
                onImage = { name, bytes -> vm.attachImage(name, bytes) },
                onCreateChild = vm::createChildTask,
                onPromote = { vm.promote(note.path) },
            )
        }
        else -> {
            TasksHomeScreen(
                state = state,
                rows = vm.displayRows(),
                onOpenDrawerList = vm::openList,
                onSetView = vm::setView,
                onFilters = vm::updateFilters,
                onToggle = vm::toggleStatus,
                onSelect = {
                    vm.selectTask(it)
                    screen = Screen.Detail
                },
                onOpenComposer = vm::openComposer,
                onCreate = { title, list, due, priority, labels ->
                    vm.createTask(title, list, due, priority, labels)
                },
                onOpenSync = { screen = Screen.Sync },
                onCreateList = vm::createList,
            )
        }
    }
}

package com.markspace.tasks.data

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.markspace.sync.ConflictChoice
import com.markspace.sync.SyncResult
import com.markspace.sync.SyncStatus
import com.markspace.sync.VaultSync
import com.markspace.tasknotes.TaskIndexEntry
import com.markspace.tasknotes.TaskNote
import com.markspace.tasknotes.TaskRepository
import com.markspace.tasknotes.TasksFilters
import com.markspace.tasknotes.TasksViewId
import com.markspace.tasknotes.buildDisplayRows
import com.markspace.tasknotes.collectTaskLabels
import com.markspace.tasknotes.filterTaskIndex
import com.markspace.tasknotes.localDateYmd
import com.markspace.tasks.TasksApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

data class TasksUiState(
    val ready: Boolean = false,
    val needsOnboarding: Boolean = true,
    val view: TasksViewId = TasksViewId.Inbox,
    val filters: TasksFilters = TasksFilters(),
    val index: List<TaskIndexEntry> = emptyList(),
    val lists: List<String> = listOf("Inbox"),
    val labelCatalog: List<String> = emptyList(),
    val selectedPath: String? = null,
    val selectedNote: TaskNote? = null,
    val syncPrefs: SyncPrefs = SyncPrefs(),
    val syncStatus: SyncStatus = SyncStatus(),
    val syncBusy: Boolean = false,
    val syncMessage: String? = null,
    val error: String? = null,
    val composerOpen: Boolean = false,
)

class TasksViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = (application as TasksApp).syncPreferences
    private val vaultRoot = prefs.vaultDir()
    private val sync = VaultSync(vaultRoot)
    private var repo = TaskRepository(vaultRoot)
    private var autoJob: Job? = null

    private val _state = MutableStateFlow(TasksUiState())
    val state: StateFlow<TasksUiState> = _state.asStateFlow()

    fun vaultDir(): java.io.File = vaultRoot

    init {
        val loaded = prefs.load()
        _state.update {
            it.copy(
                syncPrefs = loaded,
                needsOnboarding = !loaded.cloned,
                ready = true,
            )
        }
        if (loaded.cloned) {
            refresh()
            restartAutosync()
        }
    }

    fun displayRows(): List<Pair<TaskIndexEntry, Int>> {
        val s = _state.value
        val filtered = filterTaskIndex(s.index, s.view, s.filters, localDateYmd())
        return buildDisplayRows(filtered)
    }

    fun setView(view: TasksViewId) {
        val next = if (view == TasksViewId.Upcoming) TasksViewId.Today else view
        _state.update {
            it.copy(
                view = next,
                filters = if (next == TasksViewId.All) it.filters else it.filters.copy(list = ""),
            )
        }
    }

    fun openList(list: String) {
        _state.update {
            it.copy(
                view = TasksViewId.All,
                filters = it.filters.copy(list = list, status = "open"),
            )
        }
    }

    fun updateFilters(filters: TasksFilters) {
        _state.update { it.copy(filters = filters, view = TasksViewId.Filters) }
    }

    fun refresh() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                repo.ensureLayout()
                val index = repo.loadIndex()
                val lists = repo.listFolders()
                val selected = _state.value.selectedPath
                val note = selected?.let { runCatching { repo.loadNote(it) }.getOrNull() }
                _state.update {
                    it.copy(
                        index = index,
                        lists = lists,
                        labelCatalog = collectTaskLabels(index),
                        selectedNote = note,
                        error = null,
                    )
                }
            }
        }
    }

    fun selectTask(path: String?) {
        viewModelScope.launch {
            val note = withContext(Dispatchers.IO) {
                path?.let { runCatching { repo.loadNote(it) }.getOrNull() }
            }
            _state.update { it.copy(selectedPath = path, selectedNote = note) }
        }
    }

    fun toggleStatus(path: String, currentlyDone: Boolean) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                repo.setStatus(path, if (currentlyDone) "open" else "done")
            }
            refresh()
        }
    }

    fun openComposer(open: Boolean) {
        _state.update { it.copy(composerOpen = open) }
    }

    fun createTask(
        title: String,
        list: String,
        due: String?,
        priority: Int?,
        labels: List<String>,
        parent: String? = null,
    ) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                repo.createTask(
                    title = title,
                    list = list,
                    due = due,
                    priority = priority,
                    labels = labels,
                    parent = parent,
                )
            }
            _state.update { it.copy(composerOpen = false) }
            refresh()
        }
    }

    fun saveSelected(
        title: String,
        due: String?,
        clearDue: Boolean,
        priority: Int?,
        clearPriority: Boolean,
        labels: List<String>,
        status: String,
    ) {
        val path = _state.value.selectedPath ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                repo.updateAttrs(
                    relPath = path,
                    title = title,
                    due = due,
                    clearDue = clearDue,
                    priority = priority,
                    clearPriority = clearPriority,
                    labels = labels,
                    status = status,
                )
            }
            refresh()
            selectTask(path)
        }
    }

    fun appendComment(body: String) {
        val path = _state.value.selectedPath ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repo.appendComment(path, body) }
            selectTask(path)
            refresh()
        }
    }

    fun attachImage(fileName: String, bytes: ByteArray, caption: String = "") {
        val path = _state.value.selectedPath ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                val rel = repo.writeAsset(path, fileName, bytes)
                val body = buildString {
                    if (caption.isNotBlank()) append(caption.trim()).append("\n\n")
                    append("![]($rel)")
                }
                repo.appendComment(path, body)
            }
            selectTask(path)
            refresh()
        }
    }

    fun nestChild(childPath: String, parentId: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repo.nestAsChild(childPath, parentId) }
            refresh()
        }
    }

    fun promote(path: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repo.promoteToRoot(path) }
            refresh()
            selectTask(path)
        }
    }

    fun createChildTask(title: String) {
        val parent = _state.value.selectedNote ?: return
        val list = com.markspace.tasknotes.taskListFromPath(parent.path).ifEmpty { "Inbox" }
        createTask(title, list, null, null, emptyList(), parent.attrs.id)
    }

    fun createList(name: String) {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repo.createList(name) }
            refresh()
        }
    }

    fun createLocalVault() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                vaultRoot.mkdirs()
                repo.ensureLayout()
            }
            val next = _state.value.syncPrefs.copy(cloned = true)
            prefs.save(next)
            _state.update {
                it.copy(
                    syncPrefs = next,
                    needsOnboarding = false,
                    syncMessage = "Local vault ready — connect GitHub anytime in Sync",
                )
            }
            refresh()
        }
    }

    fun saveSyncPrefs(remoteUrl: String, token: String, autoMinutes: Int) {
        val next = _state.value.syncPrefs.copy(
            remoteUrl = remoteUrl.trim(),
            token = token.trim(),
            autoSyncMinutes = autoMinutes,
        )
        prefs.save(next)
        _state.update { it.copy(syncPrefs = next) }
        restartAutosync()
    }

    fun cloneOrConnect() {
        val p = _state.value.syncPrefs
        if (p.remoteUrl.isBlank() || p.token.isBlank()) {
            _state.update { it.copy(error = "Remote URL and token are required") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(syncBusy = true, error = null, syncMessage = null) }
            try {
                val st = withContext(Dispatchers.IO) {
                    sync.cloneVault(p.remoteUrl, p.token)
                }
                val next = p.copy(cloned = true, lastSyncAt = Instant.now().toString(), remoteUrl = st.remoteUrl ?: p.remoteUrl)
                prefs.save(next)
                repo = TaskRepository(vaultRoot)
                _state.update {
                    it.copy(
                        syncBusy = false,
                        syncPrefs = next,
                        syncStatus = st,
                        needsOnboarding = false,
                        syncMessage = "Connected",
                    )
                }
                refresh()
                restartAutosync()
            } catch (e: Exception) {
                _state.update {
                    it.copy(syncBusy = false, error = e.message ?: "Clone failed")
                }
            }
        }
    }

    fun syncNow() {
        val token = _state.value.syncPrefs.token
        if (token.isBlank()) {
            _state.update { it.copy(error = "Save a GitHub token first") }
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(syncBusy = true, error = null) }
            try {
                val result: SyncResult = withContext(Dispatchers.IO) { sync.syncNow(token) }
                val next = _state.value.syncPrefs.copy(lastSyncAt = Instant.now().toString())
                prefs.save(next)
                _state.update {
                    it.copy(
                        syncBusy = false,
                        syncStatus = result.status,
                        syncPrefs = next,
                        syncMessage = result.message,
                        error = result.status.lastError,
                    )
                }
                refresh()
            } catch (e: Exception) {
                _state.update {
                    it.copy(syncBusy = false, error = e.message ?: "Sync failed")
                }
            }
        }
    }

    fun resolveConflict(path: String, choice: ConflictChoice) {
        viewModelScope.launch {
            val st = withContext(Dispatchers.IO) {
                sync.resolveConflict(path, choice, _state.value.syncPrefs.token.ifBlank { null })
            }
            _state.update { it.copy(syncStatus = st) }
            refresh()
        }
    }

    fun onResumeSync() {
        if (_state.value.syncPrefs.cloned && _state.value.syncPrefs.autoSyncMinutes > 0) {
            syncNow()
        } else if (_state.value.syncPrefs.cloned) {
            viewModelScope.launch {
                val st = withContext(Dispatchers.IO) {
                    sync.status(_state.value.syncPrefs.token.ifBlank { null })
                }
                _state.update { it.copy(syncStatus = st) }
            }
        }
    }

    private fun restartAutosync() {
        autoJob?.cancel()
        val minutes = _state.value.syncPrefs.autoSyncMinutes
        if (minutes <= 0 || !_state.value.syncPrefs.cloned) return
        autoJob = viewModelScope.launch {
            while (isActive) {
                delay(minutes * 60_000L)
                if (!_state.value.syncBusy) syncNow()
            }
        }
    }
}

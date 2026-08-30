package com.markspace.tasknotes

import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Filesystem-backed Tasks vault under a local root (git working tree).
 */
class TaskRepository(val vaultRoot: File) {

    fun tasksDir(): File = File(vaultRoot, TASKS_ROOT)

    fun ensureLayout() {
        File(vaultRoot, TASKS_INBOX).mkdirs()
    }

    fun listFolders(): List<String> {
        val root = tasksDir()
        if (!root.isDirectory) return listOf("Inbox")
        val names = root.listFiles()
            ?.filter { it.isDirectory && !it.name.startsWith('.') && it.name != TASKS_COMPLETED_DIR }
            ?.map { it.name }
            ?.sorted()
            .orEmpty()
        return if (names.contains("Inbox")) names else listOf("Inbox") + names
    }

    fun collectTaskFiles(): List<File> {
        val root = tasksDir()
        if (!root.isDirectory) return emptyList()
        val out = mutableListOf<File>()
        fun walk(dir: File) {
            val kids = dir.listFiles()?.sortedBy { it.name } ?: return
            for (child in kids) {
                if (child.isDirectory) {
                    if (child.name == TASKS_COMPLETED_DIR || child.name.startsWith('.')) continue
                    walk(child)
                } else if (child.name.endsWith(".md", ignoreCase = true) &&
                    !child.name.equals(".folder.md", ignoreCase = true)
                ) {
                    val rel = relativePath(child)
                    if (isTaskNotePath(rel) && !isTaskInCompleted(rel)) {
                        out.add(child)
                    }
                }
            }
        }
        walk(root)
        return out
    }

    fun relativePath(file: File): String =
        vaultRoot.toPath().relativize(file.toPath()).toString().replace('\\', '/')

    fun absolutePath(rel: String): File = File(vaultRoot, rel)

    fun loadIndex(): List<TaskIndexEntry> {
        val notes = collectTaskFiles().map { file ->
            val md = file.readText(StandardCharsets.UTF_8)
            parseTaskNote(relativePath(file), md)
        }
        return enrichTaskIndexChildren(notes.map { taskIndexEntryFromNote(it) })
    }

    fun loadNote(relPath: String): TaskNote {
        val file = absolutePath(relPath)
        return parseTaskNote(relPath, file.readText(StandardCharsets.UTF_8))
    }

    fun saveNote(note: TaskNote) {
        val file = absolutePath(note.path)
        file.parentFile?.mkdirs()
        file.writeText(serializeTaskNote(note), StandardCharsets.UTF_8)
    }

    fun createTask(
        title: String,
        list: String = "Inbox",
        due: String? = null,
        priority: TaskPriority? = null,
        labels: List<String> = emptyList(),
        parent: String? = null,
        description: String = "",
    ): TaskNote {
        ensureLayout()
        val listName = list.trim('/').ifEmpty { "Inbox" }
        val folder = File(tasksDir(), listName)
        folder.mkdirs()
        var name = taskFileNameFromTitle(title)
        var file = File(folder, name)
        var n = 2
        while (file.exists() && n < 50) {
            val stem = name.removeSuffix(".md")
            file = File(folder, "$stem-$n.md")
            n++
        }
        val rel = relativePath(file)
        val note = TaskNote(
            path = rel,
            title = title.trim().ifEmpty { "Untitled" },
            attrs = TaskAttrs(
                status = "open",
                due = due,
                priority = priority,
                labels = labels,
                created = localDateYmd(),
                id = newTaskId(),
                parent = parent,
            ),
            description = description,
        )
        saveNote(note)
        return note
    }

    fun setStatus(relPath: String, status: TaskStatus) {
        val note = loadNote(relPath)
        saveNote(note.copy(attrs = note.attrs.copy(status = status)))
    }

    fun updateAttrs(
        relPath: String,
        title: String? = null,
        due: String? = null,
        clearDue: Boolean = false,
        priority: TaskPriority? = null,
        clearPriority: Boolean = false,
        labels: List<String>? = null,
        parent: String? = null,
        clearParent: Boolean = false,
        status: TaskStatus? = null,
    ) {
        var note = loadNote(relPath)
        var attrs = note.attrs
        if (status != null) attrs = attrs.copy(status = status)
        if (clearDue) attrs = attrs.copy(due = null)
        else if (due != null) attrs = attrs.copy(due = due)
        if (clearPriority) attrs = attrs.copy(priority = null)
        else if (priority != null) attrs = attrs.copy(priority = priority)
        if (labels != null) attrs = attrs.copy(labels = labels)
        if (clearParent) attrs = attrs.copy(parent = null)
        else if (parent != null) attrs = attrs.copy(parent = parent)
        note = note.copy(
            title = title ?: note.title,
            attrs = attrs,
        )
        saveNote(note)
    }

    fun moveToList(relPath: String, newList: String): String {
        val note = loadNote(relPath)
        val listName = newList.trim('/').ifEmpty { "Inbox" }
        val folder = File(tasksDir(), listName)
        folder.mkdirs()
        val fileName = File(relPath).name
        var dest = File(folder, fileName)
        var n = 2
        while (dest.exists() && dest.absolutePath != absolutePath(relPath).absolutePath && n < 50) {
            val stem = fileName.removeSuffix(".md")
            dest = File(folder, "$stem-$n.md")
            n++
        }
        val src = absolutePath(relPath)
        // Move sibling .assets if present
        val srcAssets = File(src.parentFile, ".assets")
        src.renameTo(dest)
        if (srcAssets.isDirectory) {
            val destAssets = File(dest.parentFile, ".assets")
            if (!destAssets.exists()) {
                srcAssets.renameTo(destAssets)
            }
        }
        val newRel = relativePath(dest)
        saveNote(note.copy(path = newRel))
        return newRel
    }

    fun appendComment(relPath: String, body: String, at: String = localDateTimeHm()) {
        val note = loadNote(relPath)
        val comments = note.comments + TaskComment(at, body.trim())
        saveNote(note.copy(comments = comments))
    }

    fun nestAsChild(childPath: String, parentId: String) {
        updateAttrs(childPath, parent = parentId)
    }

    fun promoteToRoot(childPath: String) {
        updateAttrs(childPath, clearParent = true)
    }

    /** Copy image bytes into note's sibling `.assets/` and return markdown-relative path. */
    fun writeAsset(noteRelPath: String, fileName: String, bytes: ByteArray): String {
        val noteFile = absolutePath(noteRelPath)
        val assets = File(noteFile.parentFile, ".assets")
        assets.mkdirs()
        val safe = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        var dest = File(assets, safe)
        var n = 2
        while (dest.exists()) {
            val stem = safe.substringBeforeLast('.')
            val ext = safe.substringAfterLast('.', "")
            dest = File(assets, if (ext.isEmpty()) "$stem-$n" else "$stem-$n.$ext")
            n++
        }
        dest.writeBytes(bytes)
        return ".assets/${dest.name}"
    }

    fun createList(name: String): String {
        val cleaned = name.trim().replace(Regex("[/\\\\]"), "-").replace(Regex("\\s+"), " ")
        require(cleaned.isNotEmpty()) { "List name is required" }
        require(!cleaned.equals("Inbox", ignoreCase = true)) { "Inbox is a reserved list" }
        require(!cleaned.equals(TASKS_COMPLETED_DIR, ignoreCase = true)) { "completed is reserved" }
        ensureLayout()
        File(tasksDir(), cleaned).mkdirs()
        return cleaned
    }
}

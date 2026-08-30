package com.markspace.tasknotes

private val SUBTASKS_HEADING = Regex("^##\\s+Subtasks\\s*$", RegexOption.IGNORE_CASE)
private val COMMENTS_HEADING = Regex("^##\\s+Comments\\s*$", RegexOption.IGNORE_CASE)
private val TITLE_HEADING = Regex("^#\\s+(.+?)\\s*$")
private val COMMENT_AT = Regex("^###\\s+(\\d{4}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2})\\s*$")
private val TASK_LINE = Regex("^([ \\t]*)([*+-]|\\d+\\.)[ \\t]+\\[([ xX])][ \\t]+(.*)$")

private fun parseDue(value: Any?): String? {
    when (value) {
        null -> return null
        is String -> {
            val t = value.trim()
            if (Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(t)) return t
            val m = Regex("^(\\d{4}-\\d{2}-\\d{2})").find(t)
            return m?.groupValues?.get(1)
        }
        is java.util.Date -> {
            val cal = java.util.Calendar.getInstance().apply { time = value }
            return "%04d-%02d-%02d".format(
                cal.get(java.util.Calendar.YEAR),
                cal.get(java.util.Calendar.MONTH) + 1,
                cal.get(java.util.Calendar.DAY_OF_MONTH),
            )
        }
        is java.time.LocalDate -> return value.toString()
        is java.time.LocalDateTime -> return value.toLocalDate().toString()
        is Number -> return null
        else -> {
            // SnakeYAML may yield other temporal types
            val s = value.toString().trim()
            val m = Regex("^(\\d{4}-\\d{2}-\\d{2})").find(s)
            return m?.groupValues?.get(1)
        }
    }
}

private fun parsePriority(value: Any?): TaskPriority? {
    when (value) {
        is Number -> {
            val n = value.toInt()
            if (n in 1..4) return n
        }
        is String -> {
            if (value.trim().isNotEmpty()) {
                val n = value.trim().toDoubleOrNull()?.toInt()
                if (n != null && n in 1..4) return n
            }
        }
    }
    return null
}

private fun parseStatus(value: Any?): TaskStatus =
    if (value is String && value.trim().equals("done", ignoreCase = true)) "done" else "open"

private fun parseTaskId(value: Any?): String {
    if (value !is String) return ""
    val t = value.trim()
    return if (isTaskUuid(t)) t else ""
}

private fun parseParent(value: Any?): String? {
    if (value !is String) return null
    val t = value.replace(Regex("^/+|/+$"), "").trim()
    if (t.isEmpty()) return null
    if (isTaskUuid(t)) return t
    if (isTaskNotePath(t)) return t
    return null
}

fun getTaskAttrs(markdown: String): TaskAttrs {
    val data = splitFrontmatter(markdown).data ?: return emptyTaskAttrs()
    return TaskAttrs(
        status = parseStatus(data["status"]),
        due = parseDue(data["due"]),
        priority = parsePriority(data["priority"]),
        labels = normalizeTags(data["labels"]),
        created = parseDue(data["created"]),
        id = parseTaskId(data["id"]),
        parent = parseParent(data["parent"]),
    )
}

fun setTaskAttrs(markdown: String, patch: TaskAttrsPatch): String {
    val split = splitFrontmatter(markdown)
    if (split.hasFence && split.data == null) return markdown

    val current = getTaskAttrs(markdown)
    val next = current.applyPatch(patch)
    val data = (split.data ?: mutableMapOf()).toMutableMap()

    data["status"] = next.status
    if (next.due != null) data["due"] = next.due else data.remove("due")
    if (next.priority != null) data["priority"] = next.priority else data.remove("priority")
    if (next.labels.isNotEmpty()) data["labels"] = next.labels else data.remove("labels")
    if (next.created != null) data["created"] = next.created else data.remove("created")
    if (next.id.isNotEmpty()) data["id"] = next.id else data.remove("id")
    if (next.parent != null) data["parent"] = next.parent else data.remove("parent")

    return mergeFrontmatter(data, split.body)
}

data class TaskAttrsPatch(
    val status: TaskStatus? = null,
    val due: String? = UNSET_STR,
    val clearDue: Boolean = false,
    val priority: TaskPriority? = UNSET_PRI,
    val clearPriority: Boolean = false,
    val labels: List<String>? = null,
    val created: String? = UNSET_STR,
    val clearCreated: Boolean = false,
    val id: String? = null,
    val parent: String? = UNSET_STR,
    val clearParent: Boolean = false,
) {
    companion object {
        const val UNSET_STR = "\u0000unset"
        const val UNSET_PRI = -999
    }
}

private fun TaskAttrs.applyPatch(p: TaskAttrsPatch): TaskAttrs {
    var due = this.due
    if (p.clearDue) due = null
    else if (p.due != null && p.due != TaskAttrsPatch.UNSET_STR) due = p.due

    var priority = this.priority
    if (p.clearPriority) priority = null
    else if (p.priority != null && p.priority != TaskAttrsPatch.UNSET_PRI) priority = p.priority

    var created = this.created
    if (p.clearCreated) created = null
    else if (p.created != null && p.created != TaskAttrsPatch.UNSET_STR) created = p.created

    var parent = this.parent
    if (p.clearParent) parent = null
    else if (p.parent != null && p.parent != TaskAttrsPatch.UNSET_STR) parent = p.parent

    return copy(
        status = p.status ?: status,
        due = due,
        priority = priority,
        labels = p.labels ?: labels,
        created = created,
        id = p.id ?: id,
        parent = parent,
    )
}

fun flattenSubtasksOneLevel(items: List<TaskSubtask>): List<TaskSubtask> {
    val out = mutableListOf<TaskSubtask>()
    fun walk(list: List<TaskSubtask>) {
        for (it in list) {
            out.add(TaskSubtask(it.text, it.checked, emptyList()))
            if (it.children.isNotEmpty()) walk(it.children)
        }
    }
    walk(items)
    return out
}

private fun parseSubtaskLines(lines: List<String>): List<TaskSubtask> {
    data class Frame(val item: TaskSubtask, val indent: Int, val children: MutableList<TaskSubtask>)
    val roots = mutableListOf<TaskSubtask>()
    val rootChildren = mutableListOf<MutableList<TaskSubtask>>()
    val stack = mutableListOf<Frame>()

    for (line in lines) {
        val m = TASK_LINE.find(line) ?: continue
        val indent = m.groupValues[1].replace("\t", "  ").length
        val checked = m.groupValues[3].lowercase() == "x"
        val text = m.groupValues[4].trimEnd()
        val children = mutableListOf<TaskSubtask>()
        val item = TaskSubtask(text, checked, children)

        while (stack.isNotEmpty() && indent <= stack.last().indent) {
            val frame = stack.removeAt(stack.lastIndex)
            // freeze children into item — already mutable list shared
            frame.item // no-op; children already filled
        }
        if (stack.isEmpty()) {
            roots.add(item)
            rootChildren.add(children)
        } else {
            stack.last().children.add(item)
        }
        stack.add(Frame(item, indent, children))
    }
    // Rebuild with immutable children lists
    fun freeze(item: TaskSubtask): TaskSubtask =
        TaskSubtask(item.text, item.checked, item.children.map { freeze(it) })
    return roots.map { freeze(it) }
}

private fun serializeSubtasks(items: List<TaskSubtask>, indent: Int = 0): List<String> {
    val pad = "  ".repeat(indent)
    val out = mutableListOf<String>()
    for (item in items) {
        val mark = if (item.checked) "x" else " "
        out.add("$pad- [$mark] ${item.text}")
        if (item.children.isNotEmpty()) {
            out.addAll(serializeSubtasks(item.children, indent + 1))
        }
    }
    return out
}

private data class BodyParts(
    val title: String,
    val description: String,
    val subtasks: List<TaskSubtask>,
    val comments: List<TaskComment>,
)

private fun parseBody(body: String): BodyParts {
    val lines = body.replace("\r\n", "\n").split("\n")
    var title = ""
    var i = 0
    while (i < lines.size && lines[i].trim().isEmpty()) i++
    if (i < lines.size) {
        val tm = TITLE_HEADING.find(lines[i])
        if (tm != null) {
            title = tm.groupValues[1].trim()
            i++
        }
    }

    val descLines = mutableListOf<String>()
    val subtaskLines = mutableListOf<String>()
    val commentLines = mutableListOf<String>()
    var mode = "desc"

    while (i < lines.size) {
        val line = lines[i]
        when {
            SUBTASKS_HEADING.matches(line) -> mode = "subtasks"
            COMMENTS_HEADING.matches(line) -> mode = "comments"
            mode == "desc" -> descLines.add(line)
            mode == "subtasks" -> subtaskLines.add(line)
            else -> commentLines.add(line)
        }
        i++
    }

    while (descLines.isNotEmpty() && descLines.last().trim().isEmpty()) descLines.removeAt(descLines.lastIndex)
    while (descLines.isNotEmpty() && descLines.first().trim().isEmpty()) descLines.removeAt(0)

    val comments = mutableListOf<TaskComment>()
    var curAt: String? = null
    var curBody = mutableListOf<String>()
    fun flush() {
        val at = curAt ?: return
        comments.add(
            TaskComment(
                at = at,
                body = curBody.joinToString("\n").trim('\n'),
            ),
        )
        curAt = null
        curBody = mutableListOf()
    }
    for (line in commentLines) {
        val cm = COMMENT_AT.find(line)
        if (cm != null) {
            flush()
            curAt = cm.groupValues[1]
            continue
        }
        if (curAt != null) curBody.add(line)
    }
    flush()

    return BodyParts(
        title = title,
        description = descLines.joinToString("\n"),
        subtasks = flattenSubtasksOneLevel(parseSubtaskLines(subtaskLines)),
        comments = comments,
    )
}

private fun displayTitle(path: String, parsedTitle: String): String {
    if (parsedTitle.trim().isNotEmpty()) return parsedTitle.trim()
    val base = path.substringAfterLast('/')
    return base.replace(Regex("\\.md$", RegexOption.IGNORE_CASE), "").ifEmpty { "Untitled" }
}

fun parseTaskNote(path: String, markdown: String): TaskNote {
    val attrs = getTaskAttrs(markdown)
    val split = splitFrontmatter(markdown)
    val parts = parseBody(split.body)
    val known = setOf("id", "status", "due", "priority", "labels", "created", "parent")
    val extra = split.data?.filterKeys { it !in known } ?: emptyMap()
    return TaskNote(
        path = path,
        title = displayTitle(path, parts.title),
        attrs = attrs,
        description = parts.description,
        subtasks = parts.subtasks,
        comments = parts.comments,
        extraFrontmatter = extra,
    )
}

fun serializeTaskNote(note: TaskNote): String {
    val data = linkedMapOf<String, Any?>()
    if (note.attrs.id.isNotEmpty()) data["id"] = note.attrs.id
    data["status"] = note.attrs.status
    note.attrs.due?.let { data["due"] = it }
    note.attrs.priority?.let { data["priority"] = it }
    if (note.attrs.labels.isNotEmpty()) data["labels"] = note.attrs.labels
    note.attrs.created?.let { data["created"] = it }
    note.attrs.parent?.let { data["parent"] = it }
    for ((k, v) in note.extraFrontmatter) {
        if (k !in data) data[k] = v
    }

    val chunks = mutableListOf("# ${note.title.trim().ifEmpty { "Untitled" }}")
    if (note.description.trim().isNotEmpty()) {
        chunks.add("")
        chunks.add(note.description.trim())
    }
    if (note.subtasks.isNotEmpty()) {
        chunks.add("")
        chunks.add("## Subtasks")
        chunks.add("")
        chunks.addAll(serializeSubtasks(note.subtasks))
    }
    if (note.comments.isNotEmpty()) {
        chunks.add("")
        chunks.add("## Comments")
        chunks.add("")
        note.comments.forEachIndexed { i, c ->
            if (i > 0) chunks.add("")
            chunks.add("### ${c.at}")
            chunks.add("")
            chunks.add(c.body.trim().ifEmpty { "" })
        }
    }
    val body = chunks.joinToString("\n").trimEnd('\n') + "\n"
    return mergeFrontmatter(data, body)
}

fun taskIndexEntryFromNote(note: TaskNote): TaskIndexEntry =
    TaskIndexEntry(
        path = note.path,
        id = note.attrs.id,
        title = note.title,
        status = note.attrs.status,
        due = note.attrs.due,
        priority = note.attrs.priority,
        labels = note.attrs.labels,
        created = note.attrs.created,
        parent = note.attrs.parent,
        list = taskListFromPath(note.path),
        subtaskTotal = 0,
        subtaskDone = 0,
        commentCount = note.comments.size,
        subtasks = note.subtasks,
        description = note.description,
    )

fun collectTaskLabels(entries: List<TaskIndexEntry>): List<String> {
    val set = sortedSetOf(String.CASE_INSENSITIVE_ORDER)
    for (e in entries) {
        for (g in e.labels) {
            val t = g.trim()
            if (t.isNotEmpty()) set.add(t)
        }
    }
    return set.toList().sortedBy { it.lowercase() }
}

fun enrichTaskIndexChildren(entries: List<TaskIndexEntry>): List<TaskIndexEntry> {
    val byId = entries.filter { it.id.isNotEmpty() }.associateBy { it.id }
    val byPath = entries.associateBy { it.path }

    val resolved = entries.map { e ->
        var parent = e.parent
        if (parent != null && parent !in byId && parent in byPath) {
            parent = byPath[parent]!!.id.ifEmpty { null }
        } else if (parent != null && !isTaskUuid(parent)) {
            parent = null
        } else if (parent != null && parent !in byId) {
            parent = null
        }
        if (parent == e.parent) e else e.copy(parent = parent)
    }

    val kidsByParent = mutableMapOf<String, MutableList<TaskIndexEntry>>()
    for (e in resolved) {
        val p = e.parent ?: continue
        kidsByParent.getOrPut(p) { mutableListOf() }.add(e)
    }
    return resolved.map { e ->
        val kids = if (e.id.isNotEmpty()) kidsByParent[e.id].orEmpty() else emptyList()
        e.copy(
            subtaskTotal = kids.size,
            subtaskDone = kids.count { it.status == "done" },
        )
    }
}

private fun compareTasks(a: TaskIndexEntry, b: TaskIndexEntry): Int {
    val pa = a.priority ?: 99
    val pb = b.priority ?: 99
    if (pa != pb) return pa.compareTo(pb)
    val da = a.due ?: "9999-99-99"
    val db = b.due ?: "9999-99-99"
    if (da != db) return da.compareTo(db)
    return a.title.compareTo(b.title, ignoreCase = true)
}

fun filterTaskIndex(
    entries: List<TaskIndexEntry>,
    view: TasksViewId,
    filters: TasksFilters,
    today: String = localDateYmd(),
): List<TaskIndexEntry> {
    val q = filters.query.trim().lowercase()
    val label = filters.label.trim().lowercase()
    val list = filters.list.trim()

    var list_ = entries.filter { e ->
        when (view) {
            TasksViewId.Inbox -> {
                if (e.list != "Inbox") return@filter false
            }
            TasksViewId.Today -> {
                if (e.status == "done") return@filter false
                if (e.due != today) return@filter false
            }
            TasksViewId.Upcoming -> {
                if (e.status == "done") return@filter false
                if (e.due == null || e.due <= today) return@filter false
            }
            TasksViewId.All, TasksViewId.Filters -> {
                when (filters.status) {
                    "open" -> if (e.status != "open") return@filter false
                    "done" -> if (e.status != "done") return@filter false
                }
            }
        }

        if (view == TasksViewId.Inbox) {
            when (filters.status) {
                "open" -> if (e.status != "open") return@filter false
                "done" -> if (e.status != "done") return@filter false
            }
        }

        if ((view == TasksViewId.All || view == TasksViewId.Filters) && list.isNotEmpty() && e.list != list) {
            return@filter false
        }

        if (view == TasksViewId.Filters) {
            if (filters.priority != null && e.priority != filters.priority) return@filter false
            if (label.isNotEmpty() && e.labels.none { it.equals(label, ignoreCase = true) }) return@filter false
            if (q.isNotEmpty()) {
                val hay = listOf(e.title, e.list, *e.labels.toTypedArray(), e.due ?: "")
                    .joinToString("\n")
                    .lowercase()
                if (!hay.contains(q)) return@filter false
            }
        }
        true
    }

    if (view == TasksViewId.Today || view == TasksViewId.Upcoming) {
        list_ = list_.sortedWith(::compareTasks)
    }
    return list_
}

/** Build tree rows: roots then indented children (2 levels). */
fun buildDisplayRows(entries: List<TaskIndexEntry>): List<Pair<TaskIndexEntry, Int>> {
    val byParent = entries.filter { it.parent != null }.groupBy { it.parent!! }
    val roots = entries.filter { it.parent == null }
    val out = mutableListOf<Pair<TaskIndexEntry, Int>>()
    val seen = mutableSetOf<String>()
    for (root in roots) {
        if (!seen.add(root.path)) continue
        out.add(root to 0)
        val kids = if (root.id.isNotEmpty()) byParent[root.id].orEmpty() else emptyList()
        for (kid in kids) {
            if (seen.add(kid.path)) out.add(kid to 1)
        }
    }
    // Orphans (parent missing from filtered set) as roots
    for (e in entries) {
        if (seen.add(e.path)) out.add(e to 0)
    }
    return out
}

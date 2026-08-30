package com.markspace.tasknotes

const val TASKS_ROOT = "Tasks"
const val TASKS_INBOX = "Tasks/Inbox"
const val TASKS_COMPLETED_DIR = "completed"

typealias TaskStatus = String // "open" | "done"
typealias TaskPriority = Int // 1..4

data class TaskSubtask(
    val text: String,
    val checked: Boolean,
    val children: List<TaskSubtask> = emptyList(),
)

data class TaskComment(
    /** Local `YYYY-MM-DD HH:mm`. */
    val at: String,
    val body: String,
)

data class TaskAttrs(
    val status: TaskStatus = "open",
    val due: String? = null,
    val priority: TaskPriority? = null,
    val labels: List<String> = emptyList(),
    val created: String? = null,
    val id: String = "",
    val parent: String? = null,
)

data class TaskNote(
    val path: String,
    val title: String,
    val attrs: TaskAttrs,
    val description: String = "",
    val subtasks: List<TaskSubtask> = emptyList(),
    val comments: List<TaskComment> = emptyList(),
    /** Raw unknown frontmatter keys preserved on serialize when set via patch path. */
    val extraFrontmatter: Map<String, Any?> = emptyMap(),
)

data class TaskIndexEntry(
    val path: String,
    val id: String,
    val title: String,
    val status: TaskStatus,
    val due: String?,
    val priority: TaskPriority?,
    val labels: List<String>,
    val created: String?,
    val parent: String?,
    val list: String,
    val subtaskTotal: Int = 0,
    val subtaskDone: Int = 0,
    val commentCount: Int = 0,
    val subtasks: List<TaskSubtask> = emptyList(),
    val description: String = "",
)

enum class TasksViewId {
    Inbox,
    Today,
    Upcoming,
    All,
    Filters,
}

data class TasksFilters(
    val query: String = "",
    val list: String = "",
    val priority: TaskPriority? = null,
    val label: String = "",
    /** "open" | "done" | "all" */
    val status: String = "open",
)

private val TASK_UUID_RE =
    Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)

fun isTaskUuid(value: String): Boolean = TASK_UUID_RE.matches(value.trim())

fun newTaskId(): String = java.util.UUID.randomUUID().toString()

fun emptyTaskAttrs(): TaskAttrs = TaskAttrs()

fun emptyTasksFilters(): TasksFilters = TasksFilters()

fun isFolderNotePath(path: String): Boolean =
    path.replace(Regex("^/+|/+$"), "").endsWith("/.folder.md") ||
        path.replace(Regex("^/+|/+$"), "").endsWith(".folder.md")

fun isUnderTasksRoot(path: String): Boolean {
    val p = path.replace(Regex("^/+|/+$"), "")
    return p == TASKS_ROOT || p.startsWith("$TASKS_ROOT/")
}

fun isTaskNotePath(path: String): Boolean {
    val p = path.replace(Regex("^/+|/+$"), "")
    if (!p.lowercase().endsWith(".md")) return false
    if (isFolderNotePath(p)) return false
    if (!p.startsWith("$TASKS_ROOT/")) return false
    return true
}

fun taskListFromPath(path: String): String {
    val p = path.replace(Regex("^/+|/+$"), "")
    if (!p.startsWith("$TASKS_ROOT/")) return ""
    val rest = p.removePrefix("$TASKS_ROOT/")
    val parts = rest.split("/").filter { it.isNotEmpty() }
    if (parts.size <= 1) return ""
    val list = parts[0]
    if (list == TASKS_COMPLETED_DIR) return ""
    return list
}

fun isTaskInCompleted(path: String): Boolean {
    val p = path.replace(Regex("^/+|/+$"), "")
    if (!p.startsWith("$TASKS_ROOT/")) return false
    val parts = p.removePrefix("$TASKS_ROOT/").split("/").filter { it.isNotEmpty() }
    return parts.size >= 3 && parts[1] == TASKS_COMPLETED_DIR
}

fun taskCompletedFolder(list: String): String {
    val l = list.trim('/').ifEmpty { "Inbox" }
    return "$TASKS_ROOT/$l/$TASKS_COMPLETED_DIR"
}

fun localDateYmd(millis: Long = System.currentTimeMillis()): String {
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = millis }
    val y = cal.get(java.util.Calendar.YEAR)
    val m = cal.get(java.util.Calendar.MONTH) + 1
    val d = cal.get(java.util.Calendar.DAY_OF_MONTH)
    return "%04d-%02d-%02d".format(y, m, d)
}

fun localDateTimeHm(millis: Long = System.currentTimeMillis()): String {
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = millis }
    val hm = "%02d:%02d".format(
        cal.get(java.util.Calendar.HOUR_OF_DAY),
        cal.get(java.util.Calendar.MINUTE),
    )
    return "${localDateYmd(millis)} $hm"
}

fun formatTaskDueLabel(ymd: String?, today: String = localDateYmd()): String? {
    if (ymd == null || !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(ymd)) return null
    if (ymd == today) return "Today"
    val parts = today.split("-").map { it.toInt() }
    val cal = java.util.Calendar.getInstance().apply {
        set(parts[0], parts[1] - 1, parts[2])
        add(java.util.Calendar.DAY_OF_MONTH, 1)
    }
    if (ymd == localDateYmd(cal.timeInMillis)) return "Tomorrow"
    val yp = ymd.split("-").map { it.toInt() }
    val month = java.text.DateFormatSymbols.getInstance().shortMonths[yp[1] - 1]
    return "$month ${yp[2]}"
}

fun taskFileNameFromTitle(title: String): String {
    val slug = title.trim()
        .lowercase()
        .replace(Regex("[^a-z0-9]+"), "-")
        .trim('-')
        .ifEmpty { "task" }
    return "$slug.md"
}

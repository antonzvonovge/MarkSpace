package com.markspace.sync

data class SyncStatus(
    val connected: Boolean = false,
    val remoteUrl: String? = null,
    val branch: String? = null,
    val dirty: Boolean = false,
    val ahead: Int = 0,
    val behind: Int = 0,
    val conflictPaths: List<String> = emptyList(),
    val lastError: String? = null,
)

data class SyncResult(
    val status: SyncStatus,
    val committed: Boolean = false,
    val pushed: Boolean = false,
    val message: String = "",
)

enum class ConflictChoice {
    Ours,
    Theirs,
    Both,
}

object RemoteUrl {
    fun normalize(input: String): String {
        val t = input.trim()
        require(t.isNotEmpty()) { "Enter a GitHub URL or owner/repo" }
        if (t.startsWith("https://") || t.startsWith("http://") || t.startsWith("git@")) {
            return t
        }
        if (Regex("^[\\w.-]+/[\\w.-]+(?:\\.git)?$").matches(t)) {
            val repo = if (t.endsWith(".git")) t else "$t.git"
            return "https://github.com/$repo"
        }
        error("Enter a GitHub URL or owner/repo")
    }
}

package com.markspace.sync

import org.eclipse.jgit.api.Git
import org.eclipse.jgit.lib.BranchTrackingStatus
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.merge.MergeStrategy
import org.eclipse.jgit.storage.file.FileRepositoryBuilder
import org.eclipse.jgit.transport.RefSpec
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Vault git sync compatible with MarkSpace desktop (full tree, MarkSpace author).
 */
class VaultSync(private val vaultRoot: File) {

    private val author = PersonIdent("MarkSpace", "markspace@local")

    fun credentials(token: String) =
        UsernamePasswordCredentialsProvider("x-access-token", token)

    fun openOrNull(): Repository? {
        val gitDir = File(vaultRoot, ".git")
        if (!gitDir.exists()) return null
        return FileRepositoryBuilder()
            .setGitDir(gitDir)
            .setWorkTree(vaultRoot)
            .readEnvironment()
            .build()
    }

    fun cloneVault(remoteUrl: String, token: String): SyncStatus {
        if (!vaultRoot.exists()) vaultRoot.mkdirs()
        val existing = vaultRoot.list()?.filter { it != "." && it != ".." }.orEmpty()
        if (existing.isNotEmpty() && !File(vaultRoot, ".git").exists()) {
            error("Vault directory is not empty and has no .git — clear app data first")
        }
        if (File(vaultRoot, ".git").exists()) {
            return connectExisting(remoteUrl, token)
        }

        val url = RemoteUrl.normalize(remoteUrl)
        Git.cloneRepository()
            .setURI(url)
            .setDirectory(vaultRoot)
            .setCredentialsProvider(credentials(token))
            .call()
            .close()

        File(vaultRoot, "Tasks/Inbox").mkdirs()
        return status(token)
    }

    fun connectExisting(remoteUrl: String, token: String): SyncStatus {
        val url = RemoteUrl.normalize(remoteUrl)
        val repo = openOrNull() ?: run {
            Git.init().setDirectory(vaultRoot).call().close()
            openOrNull()!!
        }
        Git(repo).use { git ->
            val config = repo.config
            config.setString("remote", "origin", "url", url)
            config.setString("remote", "origin", "fetch", "+refs/heads/*:refs/remotes/origin/*")
            config.save()
            try {
                git.fetch()
                    .setRemote("origin")
                    .setCredentialsProvider(credentials(token))
                    .call()
            } catch (_: Exception) {
                // empty remote ok
            }
        }
        repo.close()
        File(vaultRoot, "Tasks/Inbox").mkdirs()
        return status(token)
    }

    fun status(token: String? = null): SyncStatus {
        val repo = openOrNull() ?: return SyncStatus(connected = false)
        return try {
            Git(repo).use { git ->
                val remote = repo.config.getString("remote", "origin", "url")
                val branch = try {
                    repo.branch
                } catch (_: Exception) {
                    null
                }
                val gitStatus = git.status().call()
                val dirty = gitStatus.hasUncommittedChanges() || gitStatus.untracked.isNotEmpty()
                val conflicts = gitStatus.conflicting.toList().sorted()

                if (token != null && remote != null) {
                    try {
                        git.fetch()
                            .setRemote("origin")
                            .setCredentialsProvider(credentials(token))
                            .call()
                    } catch (_: Exception) {
                    }
                }

                var ahead = 0
                var behind = 0
                if (branch != null) {
                    val bts = BranchTrackingStatus.of(repo, branch)
                    if (bts != null) {
                        ahead = bts.aheadCount
                        behind = bts.behindCount
                    }
                }

                SyncStatus(
                    connected = remote != null,
                    remoteUrl = remote,
                    branch = branch,
                    dirty = dirty,
                    ahead = ahead,
                    behind = behind,
                    conflictPaths = conflicts,
                )
            }
        } finally {
            repo.close()
        }
    }

    fun syncNow(token: String): SyncResult {
        val repo = openOrNull() ?: return SyncResult(
            status = SyncStatus(lastError = "Not connected"),
            message = "Clone or connect a vault first",
        )
        return try {
            Git(repo).use { git ->
                autoResolveMdConflicts(git)

                var st = git.status().call()
                if (st.conflicting.isNotEmpty()) {
                    return SyncResult(
                        status = status(token).copy(conflictPaths = st.conflicting.toList().sorted()),
                        message = "Resolve conflicts before sync",
                    )
                }

                var committed = false
                st = git.status().call()
                if (st.hasUncommittedChanges() || st.untracked.isNotEmpty()) {
                    git.add().addFilepattern(".").call()
                    val removed = st.missing + st.removed
                    if (removed.isNotEmpty()) {
                        val rm = git.rm()
                        removed.forEach { rm.addFilepattern(it) }
                        rm.call()
                    }
                    git.commit()
                        .setMessage("MarkSpace sync")
                        .setAuthor(author)
                        .setCommitter(author)
                        .call()
                    committed = true
                }

                git.fetch()
                    .setRemote("origin")
                    .setCredentialsProvider(credentials(token))
                    .call()

                val branch = repo.branch
                val remoteRef = repo.resolve("refs/remotes/origin/$branch")
                if (remoteRef != null) {
                    val result = git.merge()
                        .include(remoteRef)
                        .setStrategy(MergeStrategy.RESOLVE)
                        .setCommit(true)
                        .setMessage("MarkSpace merge")
                        .call()
                    if (result.mergeStatus == org.eclipse.jgit.api.MergeResult.MergeStatus.CONFLICTING) {
                        autoResolveMdConflicts(git)
                        val left = git.status().call().conflicting
                        if (left.isNotEmpty()) {
                            return SyncResult(
                                status = status(token).copy(conflictPaths = left.toList().sorted()),
                                committed = committed,
                                message = "Conflicts remain",
                            )
                        }
                        git.add().addFilepattern(".").call()
                        git.commit()
                            .setMessage("MarkSpace merge")
                            .setAuthor(author)
                            .setCommitter(author)
                            .call()
                    }
                }

                try {
                    git.push()
                        .setRemote("origin")
                        .setCredentialsProvider(credentials(token))
                        .setRefSpecs(RefSpec("refs/heads/$branch:refs/heads/$branch"))
                        .call()
                } catch (e: Exception) {
                    return SyncResult(
                        status = status(token).copy(lastError = e.message),
                        committed = committed,
                        pushed = false,
                        message = e.message ?: "Push failed",
                    )
                }

                SyncResult(
                    status = status(token),
                    committed = committed,
                    pushed = true,
                    message = "Synced",
                )
            }
        } finally {
            repo.close()
        }
    }

    fun resolveConflict(path: String, choice: ConflictChoice, token: String? = null): SyncStatus {
        val repo = openOrNull() ?: return SyncStatus(lastError = "Not connected")
        return try {
            Git(repo).use { git ->
                when (choice) {
                    ConflictChoice.Ours -> {
                        git.checkout()
                            .setStage(org.eclipse.jgit.api.CheckoutCommand.Stage.OURS)
                            .addPath(path)
                            .call()
                        git.add().addFilepattern(path).call()
                    }
                    ConflictChoice.Theirs -> {
                        git.checkout()
                            .setStage(org.eclipse.jgit.api.CheckoutCommand.Stage.THEIRS)
                            .addPath(path)
                            .call()
                        git.add().addFilepattern(path).call()
                    }
                    ConflictChoice.Both -> {
                        acceptBoth(File(vaultRoot, path))
                        git.add().addFilepattern(path).call()
                    }
                }
                val left = git.status().call().conflicting
                if (left.isEmpty()) {
                    git.commit()
                        .setMessage("MarkSpace merge")
                        .setAuthor(author)
                        .setCommitter(author)
                        .call()
                }
            }
            status(token)
        } finally {
            repo.close()
        }
    }

    private fun autoResolveMdConflicts(git: Git) {
        val conflicting = git.status().call().conflicting
        for (path in conflicting) {
            when {
                path.endsWith(".md", ignoreCase = true) -> {
                    acceptBoth(File(vaultRoot, path))
                    git.add().addFilepattern(path).call()
                }
                path.endsWith("order.json") || path.contains(".markspace/order.json") -> {
                    git.checkout()
                        .setStage(org.eclipse.jgit.api.CheckoutCommand.Stage.OURS)
                        .addPath(path)
                        .call()
                    git.add().addFilepattern(path).call()
                }
            }
        }
    }

    /** Strip conflict markers and keep both sides (desktop Accept Both for .md). */
    fun acceptBoth(file: File) {
        if (!file.exists()) return
        val text = file.readText(StandardCharsets.UTF_8)
        val out = StringBuilder()
        for (line in text.lineSequence()) {
            when {
                line.startsWith("<<<<<<<") -> Unit
                line.startsWith("=======") -> Unit
                line.startsWith(">>>>>>>") -> Unit
                else -> out.append(line).append('\n')
            }
        }
        file.writeText(out.toString(), StandardCharsets.UTF_8)
    }

    fun disconnect(): SyncStatus {
        val repo = openOrNull() ?: return SyncStatus()
        try {
            val config = repo.config
            config.unsetSection("remote", "origin")
            config.save()
        } finally {
            repo.close()
        }
        return SyncStatus(connected = false)
    }
}

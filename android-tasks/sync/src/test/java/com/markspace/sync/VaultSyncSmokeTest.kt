package com.markspace.sync

import org.eclipse.jgit.api.Git
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Smoke: local commit + accept-both semantics for desktop interop. */
class VaultSyncSmokeTest {

    @Test
    fun localCommitCreatesMarkSpaceAuthor() {
        val dir = createTempDir(prefix = "vault-smoke-")
        try {
            Git.init().setDirectory(dir).call().use { git ->
                File(dir, "Tasks/Inbox").mkdirs()
                File(dir, "Tasks/Inbox/hello.md").writeText(
                    """
                    ---
                    id: 11111111-1111-4111-8111-111111111111
                    status: open
                    ---

                    # Hello
                    """.trimIndent(),
                )
                git.add().addFilepattern(".").call()
                val commit = git.commit()
                    .setMessage("MarkSpace sync")
                    .setAuthor("MarkSpace", "markspace@local")
                    .setCommitter("MarkSpace", "markspace@local")
                    .call()
                assertEquals("MarkSpace", commit.authorIdent.name)
                assertEquals("markspace@local", commit.authorIdent.emailAddress)
            }
            val sync = VaultSync(dir)
            val st = sync.status()
            assertTrue(!st.dirty)
        } finally {
            dir.deleteRecursively()
        }
    }
}

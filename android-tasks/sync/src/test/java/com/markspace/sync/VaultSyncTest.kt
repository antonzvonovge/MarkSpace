package com.markspace.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class VaultSyncTest {

    @Test
    fun normalizesOwnerRepo() {
        assertEquals(
            "https://github.com/acme/vault.git",
            RemoteUrl.normalize("acme/vault"),
        )
        assertEquals(
            "https://github.com/acme/vault.git",
            RemoteUrl.normalize("https://github.com/acme/vault.git"),
        )
    }

    @Test
    fun acceptBothStripsMarkers() {
        val tmp = createTempDir()
        try {
            val f = File(tmp, "note.md")
            f.writeText(
                """
                # Title
                <<<<<<< HEAD
                local line
                =======
                remote line
                >>>>>>> origin/main
                after
                """.trimIndent(),
            )
            VaultSync(tmp).acceptBoth(f)
            val text = f.readText()
            assertTrue(text.contains("local line"))
            assertTrue(text.contains("remote line"))
            assertTrue(!text.contains("<<<<<<"))
            assertTrue(text.contains("after"))
        } finally {
            tmp.deleteRecursively()
        }
    }
}

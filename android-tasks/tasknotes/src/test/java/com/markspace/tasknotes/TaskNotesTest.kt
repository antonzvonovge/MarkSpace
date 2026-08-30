package com.markspace.tasknotes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class TaskNotesTest {

    private fun fixture(name: String): String {
        val prop = System.getProperty("tasknotes.fixtures")
        val dir = if (prop != null) File(prop) else {
            // Fallback: walk up from user.dir
            var d = File(System.getProperty("user.dir"))
            while (d != null) {
                val cand = File(d, "fixtures/task-notes")
                if (cand.isDirectory) return File(cand, name).readText()
                d = d.parentFile
            }
            error("fixtures/task-notes not found")
        }
        return File(dir, name).readText()
    }

    @Test
    fun parsesFrontmatterAndBody() {
        val note = parseTaskNote("Tasks/Work/send-report.md", fixture("send-report.md"))
        assertEquals("Send report", note.title)
        assertEquals("open", note.attrs.status)
        assertEquals("2026-08-28", note.attrs.due)
        assertEquals(2, note.attrs.priority)
        assertEquals(listOf("work", "report"), note.attrs.labels)
        assertEquals("2026-08-27", note.attrs.created)
        assertEquals(4, note.subtasks.size)
        assertEquals("Draft numbers", note.subtasks[0].text)
        assertEquals("Nested check", note.subtasks[2].text)
        assertTrue(note.subtasks[2].checked)
        assertEquals(2, note.comments.size)
        assertEquals("2026-08-27 14:02", note.comments[0].at)
        assertTrue(note.comments[0].body.contains(".assets/shot.png"))
    }

    @Test
    fun roundTripsStructuredFields() {
        val note = parseTaskNote("Tasks/Work/send-report.md", fixture("send-report.md"))
        val again = parseTaskNote(note.path, serializeTaskNote(note))
        assertEquals(note.title, again.title)
        assertEquals(note.attrs, again.attrs)
        assertEquals(note.subtasks, again.subtasks)
        assertEquals(note.comments, again.comments)
    }

    @Test
    fun usesFileStemWhenTitleMissing() {
        val note = parseTaskNote("Tasks/Inbox/buy-milk.md", fixture("no-title.md"))
        assertEquals("buy-milk", note.title)
        assertEquals("done", note.attrs.status)
    }

    @Test
    fun parsesParentUuid() {
        val note = parseTaskNote("Tasks/Work/draft.md", fixture("child-with-parent.md"))
        assertEquals("a1b2c3d4-e5f6-7890-abcd-ef1234567890", note.attrs.id)
        assertEquals("7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab", note.attrs.parent)
        val again = parseTaskNote(note.path, serializeTaskNote(note))
        assertEquals(note.attrs.parent, again.attrs.parent)
    }

    @Test
    fun minimalSerializeOmitsEmptyOptionals() {
        val note = parseTaskNote("Tasks/Inbox/quick.md", fixture("minimal.md"))
        val md = serializeTaskNote(note)
        assertTrue(md.contains("status: open"))
        assertTrue(md.contains("created: 2026-08-27"))
        assertFalse(md.contains("due:"))
        assertFalse(md.contains("## Subtasks"))
        assertFalse(md.contains("## Comments"))
        assertTrue(md.contains("# Quick"))
    }

    @Test
    fun indexEntryListAndComments() {
        val note = parseTaskNote("Tasks/Work/send-report.md", fixture("send-report.md"))
        val entry = taskIndexEntryFromNote(note)
        assertEquals("Work", entry.list)
        assertNull(entry.parent)
        assertEquals(0, entry.subtaskTotal)
        assertEquals(2, entry.commentCount)
    }

    @Test
    fun filterInboxTodayUpcoming() {
        val today = "2026-08-28"
        fun entry(
            path: String,
            title: String,
            list: String,
            due: String? = null,
            priority: Int? = null,
            status: String = "open",
            labels: List<String> = emptyList(),
        ) = TaskIndexEntry(
            path = path,
            id = "id-$path",
            title = title,
            status = status,
            due = due,
            priority = priority,
            labels = labels,
            created = null,
            parent = null,
            list = list,
        )
        val rows = listOf(
            entry("Tasks/Inbox/a.md", "Milk", "Inbox", today, 2),
            entry("Tasks/Work/b.md", "Report", "Work", today, 1, labels = listOf("work")),
            entry("Tasks/Work/c.md", "Later", "Work", "2026-09-01"),
            entry("Tasks/Inbox/d.md", "Done inbox", "Inbox", status = "done"),
        )
        assertEquals(
            listOf("Tasks/Inbox/a.md"),
            filterTaskIndex(rows, TasksViewId.Inbox, TasksFilters(status = "open"), today).map { it.path },
        )
        assertEquals(
            listOf("Tasks/Work/b.md", "Tasks/Inbox/a.md"),
            filterTaskIndex(rows, TasksViewId.Today, TasksFilters(), today).map { it.path },
        )
        assertEquals(
            listOf("Tasks/Work/c.md"),
            filterTaskIndex(rows, TasksViewId.Upcoming, TasksFilters(), today).map { it.path },
        )
        assertEquals(
            listOf("Tasks/Work/b.md"),
            filterTaskIndex(
                rows,
                TasksViewId.Filters,
                TasksFilters(list = "Work", label = "work", status = "open"),
                today,
            ).map { it.path },
        )
    }

    @Test
    fun pathHelpers() {
        assertEquals("Work", taskListFromPath("Tasks/Work/send-report.md"))
        assertEquals("Inbox", taskListFromPath("Tasks/Inbox/completed/old.md"))
        assertEquals("", taskListFromPath("Tasks/completed/orphan.md"))
        assertEquals("Tasks/Work/completed", taskCompletedFolder("Work"))
        assertTrue(isTaskInCompleted("Tasks/Work/completed/old.md"))
        assertFalse(isTaskInCompleted("Tasks/Work/send-report.md"))
    }

    @Test
    fun repositoryRoundTrip() {
        val tmp = createTempDir(prefix = "tasknotes-repo-")
        try {
            val repo = TaskRepository(tmp)
            val note = repo.createTask("Buy milk", list = "Inbox", due = "2026-08-28", priority = 1)
            assertTrue(note.attrs.id.isNotEmpty())
            assertTrue(File(tmp, note.path).exists())
            repo.setStatus(note.path, "done")
            assertEquals("done", repo.loadNote(note.path).attrs.status)
            repo.appendComment(note.path, "Purchased")
            assertEquals(1, repo.loadNote(note.path).comments.size)
            val child = repo.createTask("Check price", parent = note.attrs.id)
            val index = repo.loadIndex()
            val parent = index.first { it.path == note.path }
            assertEquals(1, parent.subtaskTotal)
            assertEquals(0, parent.subtaskDone)
            assertEquals(note.attrs.id, index.first { it.path == child.path }.parent)
        } finally {
            tmp.deleteRecursively()
        }
    }
}

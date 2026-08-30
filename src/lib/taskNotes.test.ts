import { describe, expect, it } from "vitest";
import {
  collectTaskLists,
  collectTaskNotePaths,
  filterTaskIndex,
  getTaskAttrs,
  isTaskInCompleted,
  parseTaskNote,
  serializeTaskNote,
  setTaskAttrs,
  taskCompletedFolder,
  taskIndexEntryFromNote,
  taskListFromPath,
  type TaskIndexEntry,
  type TaskNote,
} from "./taskNotes";
import type { TreeNode } from "./vaultApi";

const SAMPLE = `---
status: open
due: 2026-08-28
priority: 2
labels: [work, report]
created: 2026-08-27
---

# Send report

## Subtasks

- [ ] Draft numbers
- [ ] Ask review
  - [x] Nested check
- [x] Export PDF

## Comments

### 2026-08-27 14:02

Looks good:

![](.assets/shot.png)

### 2026-08-27 18:10

Sent to boss.
`;

describe("taskNotes parse/serialize", () => {
  it("parses frontmatter and body sections", () => {
    const note = parseTaskNote("Tasks/Work/send-report.md", SAMPLE);
    expect(note.title).toBe("Send report");
    expect(note.attrs).toEqual({
      status: "open",
      due: "2026-08-28",
      priority: 2,
      labels: ["work", "report"],
      created: "2026-08-27",
      id: "",
      parent: null,
    });
    expect(note.subtasks).toHaveLength(4);
    expect(note.subtasks[0]!.text).toBe("Draft numbers");
    expect(note.subtasks[1]!.text).toBe("Ask review");
    expect(note.subtasks[1]!.children).toHaveLength(0);
    expect(note.subtasks[2]!.text).toBe("Nested check");
    expect(note.subtasks[2]!.checked).toBe(true);
    expect(note.subtasks[3]!.checked).toBe(true);
    expect(note.comments).toHaveLength(2);
    expect(note.comments[0]!.at).toBe("2026-08-27 14:02");
    expect(note.comments[0]!.body).toContain(".assets/shot.png");
    expect(note.comments[1]!.body).toBe("Sent to boss.");
  });

  it("round-trips structured fields", () => {
    const note = parseTaskNote("Tasks/Work/send-report.md", SAMPLE);
    const again = parseTaskNote(note.path, serializeTaskNote(note));
    expect(again.title).toBe(note.title);
    expect(again.attrs).toEqual(note.attrs);
    expect(again.subtasks).toEqual(note.subtasks);
    expect(again.comments).toEqual(note.comments);
  });

  it("uses file stem when title heading is missing", () => {
    const md = `---
status: done
---

## Subtasks

- [x] Only subtask
`;
    const note = parseTaskNote("Tasks/Inbox/buy-milk.md", md);
    expect(note.title).toBe("buy-milk");
    expect(note.attrs.status).toBe("done");
  });

  it("patches attrs while preserving body", () => {
    const next = setTaskAttrs(SAMPLE, { status: "done", priority: 1 });
    expect(getTaskAttrs(next).status).toBe("done");
    expect(getTaskAttrs(next).priority).toBe(1);
    expect(getTaskAttrs(next).due).toBe("2026-08-28");
    expect(next).toContain("# Send report");
    expect(next).toContain("## Comments");
  });

  it("builds index entry with list; child counts come from enrich", () => {
    const note = parseTaskNote("Tasks/Work/send-report.md", SAMPLE);
    const entry = taskIndexEntryFromNote(note);
    expect(entry.list).toBe("Work");
    expect(entry.parent).toBeNull();
    // File-child counts are 0 until enrichTaskIndexChildren runs.
    expect(entry.subtaskTotal).toBe(0);
    expect(entry.subtaskDone).toBe(0);
    expect(entry.commentCount).toBe(2);
  });

  it("parses parent as task UUID", () => {
    const md = `---
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
status: open
parent: 7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab
---

# Draft numbers
`;
    const note = parseTaskNote("Tasks/Work/draft.md", md);
    expect(note.attrs.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(note.attrs.parent).toBe("7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab");
    const again = parseTaskNote(note.path, serializeTaskNote(note));
    expect(again.attrs.parent).toBe("7f3a2c1e-9b4d-4e2a-a1c0-1234567890ab");
    expect(again.attrs.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("keeps legacy path parent until identity migration", () => {
    const md = `---
status: open
parent: Tasks/Work/send-report.md
---

# Draft numbers
`;
    const note = parseTaskNote("Tasks/Work/draft.md", md);
    expect(note.attrs.parent).toBe("Tasks/Work/send-report.md");
  });
});

function entry(partial: Partial<TaskIndexEntry> & Pick<TaskIndexEntry, "path" | "title">): TaskIndexEntry {
  return {
    id: partial.id ?? `id-${partial.path}`,
    status: "open",
    due: null,
    priority: null,
    labels: [],
    created: null,
    parent: null,
    list: "Inbox",
    subtaskTotal: 0,
    subtaskDone: 0,
    commentCount: 0,
    subtasks: [],
    description: "",
    ...partial,
  };
}

describe("filterTaskIndex", () => {
  const today = "2026-08-28";
  const rows: TaskIndexEntry[] = [
    entry({
      path: "Tasks/Inbox/a.md",
      title: "Milk",
      list: "Inbox",
      due: today,
      priority: 2,
    }),
    entry({
      path: "Tasks/Work/b.md",
      title: "Report",
      list: "Work",
      due: today,
      priority: 1,
      labels: ["work"],
    }),
    entry({
      path: "Tasks/Work/c.md",
      title: "Later",
      list: "Work",
      due: "2026-09-01",
    }),
    entry({
      path: "Tasks/Inbox/d.md",
      title: "Done inbox",
      list: "Inbox",
      status: "done",
    }),
  ];

  it("filters inbox open tasks", () => {
    const out = filterTaskIndex(
      rows,
      "inbox",
      { query: "", list: "", priority: "", label: "", status: "open" },
      today,
    );
    expect(out.map((e) => e.path)).toEqual(["Tasks/Inbox/a.md"]);
  });

  it("preserves vault order in inbox (no priority re-sort)", () => {
    const ordered: TaskIndexEntry[] = [
      entry({
        path: "Tasks/Inbox/z.md",
        title: "Zebra",
        list: "Inbox",
        priority: 4,
      }),
      entry({
        path: "Tasks/Inbox/a.md",
        title: "Alpha",
        list: "Inbox",
        priority: 1,
      }),
    ];
    const out = filterTaskIndex(
      ordered,
      "inbox",
      { query: "", list: "", priority: "", label: "", status: "open" },
      today,
    );
    expect(out.map((e) => e.path)).toEqual([
      "Tasks/Inbox/z.md",
      "Tasks/Inbox/a.md",
    ]);
  });

  it("filters today by due date", () => {
    const out = filterTaskIndex(
      rows,
      "today",
      { query: "", list: "", priority: "", label: "", status: "open" },
      today,
    );
    expect(out.map((e) => e.path)).toEqual([
      "Tasks/Work/b.md",
      "Tasks/Inbox/a.md",
    ]);
  });

  it("applies label and list filters", () => {
    const out = filterTaskIndex(
      rows,
      "filters",
      {
        query: "",
        list: "Work",
        priority: "",
        label: "work",
        status: "open",
      },
      today,
    );
    expect(out.map((e) => e.path)).toEqual(["Tasks/Work/b.md"]);
  });

  it("ignores sticky list filter on Today", () => {
    const out = filterTaskIndex(
      rows,
      "today",
      {
        query: "",
        list: "Work",
        priority: "",
        label: "",
        status: "open",
      },
      today,
    );
    expect(out.map((e) => e.path)).toEqual([
      "Tasks/Work/b.md",
      "Tasks/Inbox/a.md",
    ]);
  });

  it("ignores sticky priority filter on Inbox", () => {
    const out = filterTaskIndex(
      rows,
      "inbox",
      {
        query: "",
        list: "",
        priority: 3,
        label: "",
        status: "open",
      },
      today,
    );
    expect(out.map((e) => e.path)).toEqual(["Tasks/Inbox/a.md"]);
  });
});

describe("serializeTaskNote minimal", () => {
  it("omits empty optional sections", () => {
    const note: Omit<TaskNote, "path"> = {
      title: "Quick",
      attrs: {
        status: "open",
        due: null,
        priority: null,
        labels: [],
        created: "2026-08-27",
        id: "11111111-1111-4111-8111-111111111111",
        parent: null,
      },
      description: "",
      subtasks: [],
      comments: [],
    };
    const md = serializeTaskNote(note);
    expect(md).toContain("status: open");
    expect(md).toContain("created: 2026-08-27");
    expect(md).not.toContain("due:");
    expect(md).not.toContain("## Subtasks");
    expect(md).not.toContain("## Comments");
    expect(md).toContain("# Quick");
  });
});

describe("completed archive paths", () => {
  it("resolves list and completed folder helpers", () => {
    expect(taskListFromPath("Tasks/Work/send-report.md")).toBe("Work");
    expect(taskListFromPath("Tasks/Inbox/completed/old.md")).toBe("Inbox");
    expect(taskListFromPath("Tasks/completed/orphan.md")).toBe("");
    expect(taskCompletedFolder("Work")).toBe("Tasks/Work/completed");
    expect(isTaskInCompleted("Tasks/Work/completed/old.md")).toBe(true);
    expect(isTaskInCompleted("Tasks/Work/send-report.md")).toBe(false);
    expect(isTaskInCompleted("Tasks/completed/x.md")).toBe(false);
  });

  it("skips completed folders when collecting active task paths and lists", () => {
    const tree: TreeNode = {
      name: "",
      path: "",
      isDir: true,
      children: [
        {
          name: "Tasks",
          path: "Tasks",
          isDir: true,
          children: [
            {
              name: "Inbox",
              path: "Tasks/Inbox",
              isDir: true,
              children: [
                {
                  name: "open.md",
                  path: "Tasks/Inbox/open.md",
                  isDir: false,
                  children: [],
                },
                {
                  name: "completed",
                  path: "Tasks/Inbox/completed",
                  isDir: true,
                  children: [
                    {
                      name: "done.md",
                      path: "Tasks/Inbox/completed/done.md",
                      isDir: false,
                      children: [],
                    },
                  ],
                },
              ],
            },
            {
              name: "completed",
              path: "Tasks/completed",
              isDir: true,
              children: [],
            },
            {
              name: "Work",
              path: "Tasks/Work",
              isDir: true,
              children: [],
            },
          ],
        },
      ],
    };
    expect(collectTaskNotePaths(tree)).toEqual(["Tasks/Inbox/open.md"]);
    expect(collectTaskLists(tree)).toEqual(["Inbox", "Work"]);
  });

  it("serializes an appended comment block", () => {
    const note = parseTaskNote(
      "Tasks/Inbox/hello.md",
      `---
id: 11111111-1111-4111-8111-111111111111
status: open
---

# Hello
`,
    );
    const withComment = {
      ...note,
      comments: [{ at: "2026-08-30 12:00", body: "Hi" }],
    };
    const out = serializeTaskNote(withComment);
    expect(out).toContain("## Comments");
    expect(out).toContain("### 2026-08-30 12:00");
    expect(out).toContain("Hi");
  });
});

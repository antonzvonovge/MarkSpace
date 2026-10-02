import { describe, expect, it } from "vitest";
import { openTaskListRows, openTaskViewRows } from "./taskListRows";
import type { TaskIndexEntry } from "./taskNotes";

function entry(patch: Partial<TaskIndexEntry> & Pick<TaskIndexEntry, "path" | "id" | "title">): TaskIndexEntry {
  return {
    status: "open",
    due: null,
    priority: null,
    labels: [],
    created: null,
    parent: null,
    list: "Work",
    subtaskTotal: 0,
    subtaskDone: 0,
    commentCount: 0,
    subtasks: [],
    description: "",
    ...patch,
  };
}

describe("openTaskListRows", () => {
  it("keeps open tasks from the chosen list and nests a child", () => {
    const rows = openTaskListRows(
      [
        entry({ path: "Tasks/Work/a.md", id: "a", title: "Alpha" }),
        entry({
          path: "Tasks/Work/b.md",
          id: "b",
          title: "Beta",
          parent: "a",
          due: "2026-10-03",
        }),
        entry({ path: "Tasks/Work/done.md", id: "d", title: "Done", status: "done" }),
        entry({ path: "Tasks/Inbox/c.md", id: "c", title: "Inbox", list: "Inbox" }),
      ],
      "Work",
    );
    expect(rows.map((row) => [row.entry.title, row.depth])).toEqual([
      ["Alpha", 0],
      ["Beta", 1],
    ]);
  });

  it("shows an open child as a root when its parent is not in the list", () => {
    const rows = openTaskListRows(
      [
        entry({ path: "Tasks/Work/parent.md", id: "p", title: "Parent", status: "done" }),
        entry({ path: "Tasks/Work/kid.md", id: "k", title: "Kid", parent: "p" }),
        entry({
          path: "Tasks/Work/completed/old.md",
          id: "old",
          title: "Archived",
        }),
      ],
      "Work",
    );
    expect(rows.map((row) => row.entry.title)).toEqual(["Kid"]);
  });

  it("today and overdue span every list and follow the sidebar sort", () => {
    const entries = [
      entry({
        path: "Tasks/Work/later.md",
        id: "later",
        title: "Later",
        due: "2026-10-09",
      }),
      entry({
        path: "Tasks/Inbox/soon.md",
        id: "soon",
        title: "Inbox today",
        list: "Inbox",
        due: "2026-10-02",
        priority: 2,
      }),
      entry({
        path: "Tasks/Work/now.md",
        id: "now",
        title: "Work today",
        due: "2026-10-02",
        priority: 1,
      }),
      entry({
        path: "Tasks/Work/done.md",
        id: "done",
        title: "Done today",
        due: "2026-10-02",
        status: "done",
      }),
      entry({
        path: "Tasks/Work/old.md",
        id: "old",
        title: "Older",
        due: "2026-09-01",
      }),
      entry({
        path: "Tasks/Inbox/late.md",
        id: "late",
        title: "Newer overdue",
        list: "Inbox",
        due: "2026-09-20",
        priority: 1,
      }),
    ];
    expect(openTaskViewRows(entries, "today", "2026-10-02").map((row) => row.entry.title)).toEqual([
      "Work today",
      "Inbox today",
    ]);
    expect(openTaskViewRows(entries, "overdue", "2026-10-02").map((row) => row.entry.title)).toEqual([
      "Newer overdue",
      "Older",
    ]);
  });
});

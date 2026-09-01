import { describe, expect, it } from "vitest";
import { taskEntriesToTreeItems } from "./buildTreeItems";
import { buildTaskTreeDisplayRows } from "./taskTreeDisplayRows";
import { parseTaskTreeId, taskTreeId } from "./types";
import { buildTree, flattenTree, getProjection } from "./utilities";
import type { TaskIndexEntry } from "../../../lib/taskNotes";

function entry(
  partial: Partial<TaskIndexEntry> & Pick<TaskIndexEntry, "path" | "title">,
): TaskIndexEntry {
  return {
    id:
      partial.id ??
      `00000000-0000-4000-8000-${String(partial.path.length).padStart(12, "0")}`,
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

describe("task tree ids", () => {
  it("round-trips task ids", () => {
    expect(parseTaskTreeId(taskTreeId("Tasks/Inbox/a.md"))).toEqual({
      kind: "task",
      path: "Tasks/Inbox/a.md",
    });
  });
});

describe("parent-based tree", () => {
  it("nests child files under parent", () => {
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const entries = [
      entry({
        path: "Tasks/Inbox/a.md",
        id: idA,
        title: "A",
        subtaskTotal: 1,
        subtaskDone: 0,
      }),
      entry({
        path: "Tasks/Inbox/b.md",
        id: idB,
        title: "B",
        parent: idA,
      }),
      entry({ path: "Tasks/Inbox/c.md", id: idC, title: "C" }),
    ];
    const tree = taskEntriesToTreeItems(entries, new Set(["Tasks/Inbox/a.md"]));
    const flat = flattenTree(tree);
    expect(flat.map((i) => i.title)).toEqual(["A", "B", "C"]);
    expect(flat.map((i) => i.depth)).toEqual([0, 1, 0]);
    expect(flat[1]!.path).toBe("Tasks/Inbox/b.md");
    expect(flat[1]!.kind).toBe("task");
  });
});

describe("buildTaskTreeDisplayRows", () => {
  it("attaches add-subtask slot to the last child of an expanded parent", () => {
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const entries = [
      entry({
        path: "Tasks/Inbox/a.md",
        id: idA,
        title: "A",
        subtaskTotal: 1,
        subtaskDone: 0,
      }),
      entry({
        path: "Tasks/Inbox/b.md",
        id: idB,
        title: "B",
        parent: idA,
      }),
    ];
    const tree = taskEntriesToTreeItems(entries, new Set(["Tasks/Inbox/a.md"]));
    const flat = flattenTree(tree);
    const rows = buildTaskTreeDisplayRows(flat, null);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.addSubtaskAfter).toBeUndefined();
    expect(rows[1]!.addSubtaskAfter).toEqual({
      parentPath: "Tasks/Inbox/a.md",
      slotDepth: 1,
    });
  });

  it("attaches add slot to parent when composer is open without children", () => {
    const entries = [
      entry({ path: "Tasks/Inbox/a.md", title: "A" }),
    ];
    const flat = flattenTree(taskEntriesToTreeItems(entries, new Set()));
    const rows = buildTaskTreeDisplayRows(flat, "Tasks/Inbox/a.md");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.addSubtaskAfter).toEqual({
      parentPath: "Tasks/Inbox/a.md",
      slotDepth: 1,
    });
  });
});

describe("getProjection", () => {
  it("allows outdent to root", () => {
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const tree = taskEntriesToTreeItems(
      [
        entry({
          path: "Tasks/Inbox/a.md",
          id: idA,
          title: "A",
          subtaskTotal: 2,
        }),
        entry({
          path: "Tasks/Inbox/b.md",
          id: idB,
          title: "B",
          parent: idA,
        }),
        entry({
          path: "Tasks/Inbox/c.md",
          id: idC,
          title: "C",
          parent: idA,
        }),
      ],
      new Set(["Tasks/Inbox/a.md"]),
    );
    const flat = flattenTree(tree);
    const b = flat.find((i) => i.title === "B")!;
    const c = flat.find((i) => i.title === "C")!;
    const proj = getProjection(flat, b.id, c.id, -28, 28);
    expect(proj.depth).toBe(0);
    expect(proj.parentId).toBeNull();
  });

  it("caps nest depth at one", () => {
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const tree = taskEntriesToTreeItems(
      [
        entry({
          path: "Tasks/Inbox/a.md",
          id: idA,
          title: "A",
          subtaskTotal: 1,
        }),
        entry({
          path: "Tasks/Inbox/b.md",
          id: idB,
          title: "B",
          parent: idA,
        }),
        entry({ path: "Tasks/Inbox/c.md", id: idC, title: "C" }),
      ],
      new Set(["Tasks/Inbox/a.md"]),
    );
    const flat = flattenTree(tree);
    const b = flat.find((i) => i.title === "B")!;
    const c = flat.find((i) => i.title === "C")!;
    const proj = getProjection(flat, c.id, b.id, 40, 28);
    expect(proj.depth).toBe(1);
    expect(proj.parentId).toBe(flat.find((i) => i.title === "A")!.id);
  });

  it("nests into the last list item when dragged one indent right", () => {
    const tree = taskEntriesToTreeItems(
      [
        entry({
          path: "Tasks/Inbox/a.md",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "A",
        }),
        entry({
          path: "Tasks/Inbox/b.md",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "B",
        }),
        entry({
          path: "Tasks/Inbox/c.md",
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          title: "C",
        }),
      ],
      new Set(),
    );
    const flat = flattenTree(tree);
    const a = flat.find((i) => i.title === "A")!;
    const c = flat.find((i) => i.title === "C")!;
    // Stock: round(offset / indent); half indent rounds up to nest.
    const proj = getProjection(flat, a.id, c.id, 14, 28);
    expect(proj.depth).toBe(1);
    expect(proj.parentId).toBe(c.id);
  });

  it("does not nest at end of list with a small right offset", () => {
    const tree = taskEntriesToTreeItems(
      [
        entry({
          path: "Tasks/Inbox/a.md",
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "A",
        }),
        entry({
          path: "Tasks/Inbox/b.md",
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          title: "B",
        }),
      ],
      new Set(),
    );
    const flat = flattenTree(tree);
    const a = flat.find((i) => i.title === "A")!;
    const b = flat.find((i) => i.title === "B")!;
    const proj = getProjection(flat, a.id, b.id, 10, 28);
    expect(proj.depth).toBe(0);
    expect(proj.parentId).toBeNull();
  });
});

describe("flatten/buildTree", () => {
  it("round-trips parent nesting", () => {
    const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const tree = taskEntriesToTreeItems(
      [
        entry({
          path: "Tasks/Inbox/a.md",
          id: idA,
          title: "A",
          subtaskTotal: 1,
        }),
        entry({
          path: "Tasks/Inbox/b.md",
          id: idB,
          title: "B",
          parent: idA,
        }),
      ],
      new Set(["Tasks/Inbox/a.md"]),
    );
    const flat = flattenTree(tree);
    const rebuilt = buildTree(flat);
    expect(rebuilt[0]!.title).toBe("A");
    expect(rebuilt[0]!.children.map((c) => c.title)).toEqual(["B"]);
  });
});

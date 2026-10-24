import { describe, expect, it } from "vitest";
import {
  attrsForGroupDrop,
  composerPrefillForSection,
  dueBucket,
  dueForBucket,
  mondayOfWeek,
  nextWeekMonday,
  partitionTasksByGroup,
  primaryLabel,
  sundayOfWeek,
} from "./taskGrouping";
import type { TaskIndexEntry } from "./taskNotes";

function entry(
  partial: Partial<TaskIndexEntry> & Pick<TaskIndexEntry, "path" | "id" | "title">,
): TaskIndexEntry {
  return {
    status: "open",
    due: null,
    priority: null,
    labels: [],
    created: "2026-10-20",
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

describe("due buckets", () => {
  // Monday 2026-10-19
  const monday = "2026-10-19";

  it("classifies relative to today", () => {
    expect(dueBucket("2026-10-18", monday)).toBe("overdue");
    expect(dueBucket(monday, monday)).toBe("today");
    expect(dueBucket("2026-10-20", monday)).toBe("tomorrow");
    expect(dueBucket("2026-10-21", monday)).toBe("thisWeek");
    expect(dueBucket("2026-10-25", monday)).toBe("thisWeek"); // Sunday
    expect(dueBucket("2026-10-26", monday)).toBe("nextWeek");
    expect(dueBucket("2026-11-02", monday)).toBe("later");
    expect(dueBucket(null, monday)).toBe("noDate");
  });

  it("week helpers use Monday start", () => {
    expect(mondayOfWeek("2026-10-22")).toBe("2026-10-19"); // Thu
    expect(sundayOfWeek("2026-10-22")).toBe("2026-10-25");
    expect(nextWeekMonday("2026-10-22")).toBe("2026-10-26");
  });

  it("dueForBucket returns stable targets", () => {
    expect(dueForBucket("overdue", monday)).toBe("2026-10-18");
    expect(dueForBucket("today", monday)).toBe(monday);
    expect(dueForBucket("tomorrow", monday)).toBe("2026-10-20");
    expect(dueForBucket("thisWeek", monday)).toBe("2026-10-21");
    expect(dueForBucket("nextWeek", monday)).toBe("2026-10-26");
    expect(dueForBucket("later", monday)).toBe("2026-11-02");
    expect(dueForBucket("noDate", monday)).toBeNull();
  });
});

describe("partitionTasksByGroup", () => {
  const today = "2026-10-20";

  it("keeps children with parent section", () => {
    const parent = entry({
      path: "Tasks/Inbox/a.md",
      id: "p1",
      title: "Parent",
      due: today,
      priority: 1,
    });
    const child = entry({
      path: "Tasks/Inbox/b.md",
      id: "c1",
      title: "Child",
      due: "2026-11-01",
      parent: "p1",
      priority: 4,
    });
    const sections = partitionTasksByGroup([parent, child], {
      groupBy: "due",
      today,
    });
    const todaySec = sections.find((s) => s.id === "today")!;
    expect(todaySec.items.map((e) => e.id)).toEqual(["p1", "c1"]);
    const later = sections.find((s) => s.id === "later")!;
    expect(later.items).toHaveLength(0);
  });

  it("partitions by priority and labels", () => {
    const a = entry({
      path: "Tasks/Inbox/a.md",
      id: "a",
      title: "A",
      priority: 2,
      labels: ["beta", "alpha"],
    });
    const b = entry({
      path: "Tasks/Inbox/b.md",
      id: "b",
      title: "B",
      labels: [],
    });
    expect(primaryLabel(a.labels)).toBe("alpha");
    const byPri = partitionTasksByGroup([a, b], { groupBy: "priority", today });
    expect(byPri.find((s) => s.id === "priority:2")!.items.map((e) => e.id)).toEqual([
      "a",
    ]);
    expect(
      byPri.find((s) => s.id === "priority:none")!.items.map((e) => e.id),
    ).toEqual(["b"]);

    const byLab = partitionTasksByGroup([a, b], {
      groupBy: "labels",
      today,
      labelCatalog: ["alpha", "beta"],
    });
    expect(byLab.find((s) => s.id === "label:alpha")!.items.map((e) => e.id)).toEqual([
      "a",
    ]);
    expect(byLab.find((s) => s.id === "label:")!.items.map((e) => e.id)).toEqual([
      "b",
    ]);
  });

  it("partitions by list", () => {
    const a = entry({
      path: "Tasks/Work/a.md",
      id: "a",
      title: "A",
      list: "Work",
    });
    const sections = partitionTasksByGroup([a], {
      groupBy: "list",
      today,
      listCatalog: ["Inbox", "Work"],
    });
    expect(sections.map((s) => s.id)).toEqual(["list:Inbox", "list:Work"]);
    expect(sections[1]!.items[0]!.id).toBe("a");
  });
});

describe("attrsForGroupDrop", () => {
  const today = "2026-10-20";

  it("maps sections to attrs / list", () => {
    expect(attrsForGroupDrop("due", "tomorrow", today)).toEqual({
      kind: "attrs",
      patch: { due: "2026-10-21" },
    });
    expect(attrsForGroupDrop("priority", "priority:3", today)).toEqual({
      kind: "attrs",
      patch: { priority: 3 },
    });
    expect(attrsForGroupDrop("labels", "label:urgent", today)).toEqual({
      kind: "attrs",
      patch: { labels: ["urgent"] },
    });
    expect(attrsForGroupDrop("list", "list:Work", today)).toEqual({
      kind: "list",
      list: "Work",
    });
  });

  it("composer prefill mirrors drop", () => {
    expect(composerPrefillForSection("due", "today", today, "Inbox")).toMatchObject({
      due: today,
      list: "Inbox",
    });
    expect(composerPrefillForSection("list", "list:Work", today, "Inbox")).toMatchObject({
      list: "Work",
    });
  });
});

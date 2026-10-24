/** Group-by sections for task lists (Todoist-style). */

import {
  isTaskDueOverdue,
  localDateYmd,
  shiftYmd,
  type TaskIndexEntry,
  type TaskPriority,
  type TasksViewId,
} from "./taskNotes";
import { TASK_PRIORITY_OPTIONS } from "./taskPriorities";

export type TaskGroupBy = "none" | "due" | "priority" | "labels" | "list";

export type TaskDueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "later"
  | "noDate";

export type TaskGroupSection = {
  id: string;
  label: string;
  /** Roots + descendants for the section tree. */
  items: TaskIndexEntry[];
};

export type TaskGroupAttrsPatch = {
  due?: string | null;
  priority?: TaskPriority | null;
  labels?: string[];
};

export type TaskGroupDropResult =
  | { kind: "attrs"; patch: TaskGroupAttrsPatch }
  | { kind: "list"; list: string };

const DUE_BUCKET_ORDER: readonly TaskDueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "nextWeek",
  "later",
  "noDate",
];

const DUE_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeek: "This week",
  nextWeek: "Next week",
  later: "Later",
  noDate: "No date",
};

export function parseTaskGroupBy(raw: unknown): TaskGroupBy {
  if (
    raw === "due" ||
    raw === "priority" ||
    raw === "labels" ||
    raw === "list" ||
    raw === "none"
  ) {
    return raw;
  }
  return "none";
}

/** Whether the list/project axis is available for this view + filters. */
export function groupByListAxisAvailable(
  view: TasksViewId,
  filterList: string,
): boolean {
  if (view === "today" || view === "overdue" || view === "all") return true;
  if (view === "filters" && !filterList.trim()) return true;
  return false;
}

export function groupByOptions(
  view: TasksViewId,
  filterList: string,
): { value: TaskGroupBy; label: string }[] {
  const base: { value: TaskGroupBy; label: string }[] = [
    { value: "none", label: "None" },
    { value: "due", label: "Due date" },
    { value: "priority", label: "Priority" },
    { value: "labels", label: "Labels" },
  ];
  if (groupByListAxisAvailable(view, filterList)) {
    base.push({ value: "list", label: "Project" });
  }
  return base;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Monday of the week containing `ymd` (weeks start Monday). */
export function mondayOfWeek(ymd: string): string {
  const d = parseYmd(ymd);
  const day = d.getDay();
  const backToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - backToMonday);
  return localDateYmd(d);
}

/** Sunday of the week containing `ymd`. */
export function sundayOfWeek(ymd: string): string {
  return shiftYmd(mondayOfWeek(ymd), 6);
}

/** Monday that starts the week after the one containing `ymd`. */
export function nextWeekMonday(ymd: string): string {
  return shiftYmd(mondayOfWeek(ymd), 7);
}

export function dueBucket(
  due: string | null | undefined,
  today: string = localDateYmd(),
): TaskDueBucket {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return "noDate";
  if (isTaskDueOverdue(due, today)) return "overdue";
  if (due === today) return "today";
  const tomorrow = shiftYmd(today, 1);
  if (due === tomorrow) return "tomorrow";
  const weekEnd = sundayOfWeek(today);
  if (due > tomorrow && due <= weekEnd) return "thisWeek";
  const nwMon = nextWeekMonday(today);
  const nwSun = shiftYmd(nwMon, 6);
  if (due >= nwMon && due <= nwSun) return "nextWeek";
  if (due > nwSun) return "later";
  return "later";
}

/** Default due when dropping/adding into a date bucket. */
export function dueForBucket(
  bucket: TaskDueBucket,
  today: string = localDateYmd(),
): string | null {
  switch (bucket) {
    case "overdue":
      return shiftYmd(today, -1);
    case "today":
      return today;
    case "tomorrow":
      return shiftYmd(today, 1);
    case "thisWeek": {
      const tomorrow = shiftYmd(today, 1);
      const weekEnd = sundayOfWeek(today);
      const candidate = shiftYmd(today, 2);
      if (candidate <= weekEnd && candidate > tomorrow) return candidate;
      if (weekEnd > tomorrow) return weekEnd;
      return weekEnd;
    }
    case "nextWeek":
      return nextWeekMonday(today);
    case "later":
      return shiftYmd(nextWeekMonday(today), 7);
    case "noDate":
      return null;
  }
}

export function labelSectionId(label: string): string {
  return `label:${label}`;
}

export function listSectionId(list: string): string {
  return `list:${list}`;
}

export function prioritySectionId(p: TaskPriority | null): string {
  return p == null ? "priority:none" : `priority:${p}`;
}

export function primaryLabel(labels: readonly string[]): string | null {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return [...cleaned].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  )[0]!;
}

export function sectionIdForEntry(
  entry: TaskIndexEntry,
  groupBy: TaskGroupBy,
  today: string = localDateYmd(),
): string {
  switch (groupBy) {
    case "none":
      return "";
    case "due":
      return dueBucket(entry.due, today);
    case "priority":
      return prioritySectionId(entry.priority);
    case "labels": {
      const primary = primaryLabel(entry.labels);
      return primary ? labelSectionId(primary) : "label:";
    }
    case "list":
      return listSectionId(entry.list || "Inbox");
  }
}

function isRootInSet(
  entry: TaskIndexEntry,
  byId: Map<string, TaskIndexEntry>,
): boolean {
  if (!entry.parent) return true;
  return !byId.has(entry.parent);
}

function collectDescendants(
  root: TaskIndexEntry,
  childrenOf: Map<string, TaskIndexEntry[]>,
): TaskIndexEntry[] {
  const out: TaskIndexEntry[] = [root];
  if (!root.id) return out;
  const kids = childrenOf.get(root.id) ?? [];
  for (const kid of kids) {
    out.push(...collectDescendants(kid, childrenOf));
  }
  return out;
}

export type PartitionOptions = {
  groupBy: TaskGroupBy;
  today?: string;
  /** Label names for empty sections (labels axis). */
  labelCatalog?: readonly string[];
  /** List names for empty sections (list axis). */
  listCatalog?: readonly string[];
};

/**
 * Partition filtered index entries into group sections.
 * Subtasks follow their root into the root's section.
 */
export function partitionTasksByGroup(
  entries: readonly TaskIndexEntry[],
  opts: PartitionOptions,
): TaskGroupSection[] {
  const { groupBy } = opts;
  if (groupBy === "none") {
    return [{ id: "", label: "", items: [...entries] }];
  }

  const today = opts.today ?? localDateYmd();
  const byId = new Map(
    entries.filter((e) => e.id).map((e) => [e.id, e] as const),
  );
  const childrenOf = new Map<string, TaskIndexEntry[]>();
  for (const e of entries) {
    if (!e.parent || !byId.has(e.parent)) continue;
    const list = childrenOf.get(e.parent) ?? [];
    list.push(e);
    childrenOf.set(e.parent, list);
  }

  const roots = entries.filter((e) => isRootInSet(e, byId));
  const buckets = new Map<string, TaskIndexEntry[]>();

  const ensure = (id: string) => {
    if (!buckets.has(id)) buckets.set(id, []);
  };

  if (groupBy === "due") {
    for (const id of DUE_BUCKET_ORDER) ensure(id);
  } else if (groupBy === "priority") {
    for (const p of [1, 2, 3, 4] as const) ensure(prioritySectionId(p));
    ensure(prioritySectionId(null));
  } else if (groupBy === "labels") {
    ensure("label:");
    for (const name of opts.labelCatalog ?? []) {
      const t = name.trim();
      if (t) ensure(labelSectionId(t));
    }
  } else if (groupBy === "list") {
    for (const name of opts.listCatalog ?? []) {
      const t = name.trim();
      if (t) ensure(listSectionId(t));
    }
  }

  for (const root of roots) {
    const id = sectionIdForEntry(root, groupBy, today);
    ensure(id);
    const chunk = collectDescendants(root, childrenOf);
    buckets.get(id)!.push(...chunk);
  }

  // Also ensure labels/lists that appear on roots but weren't in catalog.
  if (groupBy === "labels") {
    for (const root of roots) {
      const primary = primaryLabel(root.labels);
      if (primary) ensure(labelSectionId(primary));
    }
  }
  if (groupBy === "list") {
    for (const root of roots) {
      ensure(listSectionId(root.list || "Inbox"));
    }
  }

  const labelFor = (id: string): string => {
    if (groupBy === "due") {
      return DUE_BUCKET_LABELS[id as TaskDueBucket] ?? id;
    }
    if (groupBy === "priority") {
      if (id === "priority:none") return "No priority";
      const n = Number(id.replace("priority:", ""));
      if (n === 1 || n === 2 || n === 3 || n === 4) {
        return TASK_PRIORITY_OPTIONS[n - 1]!.label;
      }
      return id;
    }
    if (groupBy === "labels") {
      if (id === "label:") return "No label";
      return id.startsWith("label:") ? id.slice("label:".length) : id;
    }
    if (groupBy === "list") {
      return id.startsWith("list:") ? id.slice("list:".length) : id;
    }
    return id;
  };

  const orderIds = (): string[] => {
    if (groupBy === "due") return [...DUE_BUCKET_ORDER];
    if (groupBy === "priority") {
      return [
        prioritySectionId(1),
        prioritySectionId(2),
        prioritySectionId(3),
        prioritySectionId(4),
        prioritySectionId(null),
      ];
    }
    if (groupBy === "labels") {
      const names = [
        ...new Set(
          [...buckets.keys()]
            .filter((id) => id.startsWith("label:") && id !== "label:")
            .map((id) => id.slice("label:".length)),
        ),
      ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      return ["label:", ...names.map(labelSectionId)];
    }
    if (groupBy === "list") {
      const names = [
        ...new Set(
          [...buckets.keys()]
            .filter((id) => id.startsWith("list:"))
            .map((id) => id.slice("list:".length)),
        ),
      ];
      names.sort((a, b) => {
        if (a === "Inbox") return -1;
        if (b === "Inbox") return 1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      });
      return names.map(listSectionId);
    }
    return [...buckets.keys()];
  };

  return orderIds()
    .filter((id) => buckets.has(id))
    .map((id) => ({
      id,
      label: labelFor(id),
      items: buckets.get(id) ?? [],
    }));
}

/** Attrs / list change when dropping or adding into a section. */
export function attrsForGroupDrop(
  groupBy: TaskGroupBy,
  sectionId: string,
  today: string = localDateYmd(),
): TaskGroupDropResult | null {
  if (groupBy === "none" || !sectionId) return null;

  if (groupBy === "due") {
    if (!DUE_BUCKET_ORDER.includes(sectionId as TaskDueBucket)) return null;
    return {
      kind: "attrs",
      patch: { due: dueForBucket(sectionId as TaskDueBucket, today) },
    };
  }

  if (groupBy === "priority") {
    if (sectionId === "priority:none") {
      return { kind: "attrs", patch: { priority: null } };
    }
    const n = Number(sectionId.replace("priority:", ""));
    if (n === 1 || n === 2 || n === 3 || n === 4) {
      return { kind: "attrs", patch: { priority: n } };
    }
    return null;
  }

  if (groupBy === "labels") {
    if (sectionId === "label:") {
      return { kind: "attrs", patch: { labels: [] } };
    }
    if (sectionId.startsWith("label:")) {
      const name = sectionId.slice("label:".length).trim();
      if (!name) return { kind: "attrs", patch: { labels: [] } };
      return { kind: "attrs", patch: { labels: [name] } };
    }
    return null;
  }

  if (groupBy === "list") {
    if (!sectionId.startsWith("list:")) return null;
    const list = sectionId.slice("list:".length).trim() || "Inbox";
    return { kind: "list", list };
  }

  return null;
}

/** Prefill for the section Add-task composer. */
export function composerPrefillForSection(
  groupBy: TaskGroupBy,
  sectionId: string,
  today: string = localDateYmd(),
  fallbackList = "Inbox",
): {
  due: string | null;
  priority: TaskPriority | "";
  labels: string[];
  list: string;
} {
  const base = {
    due: null as string | null,
    priority: "" as TaskPriority | "",
    labels: [] as string[],
    list: fallbackList,
  };
  const drop = attrsForGroupDrop(groupBy, sectionId, today);
  if (!drop) return base;
  if (drop.kind === "list") {
    return { ...base, list: drop.list };
  }
  return {
    due: drop.patch.due !== undefined ? drop.patch.due : base.due,
    priority:
      drop.patch.priority === undefined
        ? base.priority
        : drop.patch.priority === null
          ? ""
          : drop.patch.priority,
    labels: drop.patch.labels ?? base.labels,
    list: base.list,
  };
}

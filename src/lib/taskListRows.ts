import {
  emptyTasksFilters,
  filterTaskIndex,
  isTaskInCompleted,
  type TaskIndexEntry,
} from "./taskNotes";

export type TaskListRow = {
  entry: TaskIndexEntry;
  depth: number;
};

function nestRows(visible: readonly TaskIndexEntry[]): TaskListRow[] {
  const byId = new Map(
    visible.filter((entry) => entry.id).map((entry) => [entry.id, entry] as const),
  );
  const childrenOf = new Map<string, TaskIndexEntry[]>();
  for (const entry of visible) {
    if (!entry.parent || !byId.has(entry.parent)) continue;
    const kids = childrenOf.get(entry.parent) ?? [];
    kids.push(entry);
    childrenOf.set(entry.parent, kids);
  }

  const rows: TaskListRow[] = [];
  for (const entry of visible) {
    if (entry.parent && byId.has(entry.parent)) continue;
    rows.push({ entry, depth: 0 });
    const kids = entry.id ? (childrenOf.get(entry.id) ?? []) : [];
    for (const kid of kids) rows.push({ entry: kid, depth: 1 });
  }
  return rows;
}

/**
 * Open tasks in one list, in vault order.
 * A child sits under its parent when that parent is also open in this list.
 * Otherwise the child is a root (parent done, archived, or in another list).
 */
export function openTaskListRows(
  entries: readonly TaskIndexEntry[],
  list: string,
): TaskListRow[] {
  const name = list.trim();
  if (!name) return [];
  return nestRows(
    entries.filter(
      (entry) =>
        entry.list === name &&
        entry.status === "open" &&
        !isTaskInCompleted(entry.path),
    ),
  );
}

/** Today or Overdue, same membership and sort as those sidebar views. */
export function openTaskViewRows(
  entries: readonly TaskIndexEntry[],
  view: "today" | "overdue",
  today?: string,
): TaskListRow[] {
  return nestRows(filterTaskIndex(entries, view, emptyTasksFilters(), today));
}

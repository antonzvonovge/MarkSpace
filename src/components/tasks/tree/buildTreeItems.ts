import type { TaskIndexEntry } from "../../../lib/taskNotes";
import { taskTreeId, type TaskTreeItem, type TaskTreeItems } from "./types";

/**
 * Build a two-level tree from index entries using frontmatter `parent` (UUID).
 * Every row is a real task file (`kind: "task"`).
 */
export function taskEntriesToTreeItems(
  entries: readonly TaskIndexEntry[],
  expanded: ReadonlySet<string>,
): TaskTreeItems {
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

  const toItem = (e: TaskIndexEntry, kids: TaskIndexEntry[]): TaskTreeItem => {
    const childItems = kids.map((c) => toItem(c, []));
    return {
      id: taskTreeId(e.path),
      kind: "task",
      path: e.path,
      title: e.title,
      status: e.status,
      priority: e.priority,
      due: e.due,
      labels: e.labels,
      commentCount: e.commentCount,
      subtaskDone: e.subtaskDone,
      subtaskTotal: e.subtaskTotal,
      children: childItems,
      collapsed: childItems.length > 0 ? !expanded.has(e.path) : false,
    };
  };

  const roots: TaskTreeItem[] = [];
  for (const e of entries) {
    // Root in this view: no parent, or parent not present in the filtered set.
    if (e.parent && byId.has(e.parent)) continue;
    roots.push(toItem(e, e.id ? (childrenOf.get(e.id) ?? []) : []));
  }
  return roots;
}

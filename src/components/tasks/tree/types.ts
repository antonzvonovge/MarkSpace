import type { MutableRefObject } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import type { TaskPriority, TaskStatus } from "../../../lib/taskNotes";

export type TaskTreeKind = "task" | "sub";

export type TaskTreeItem = {
  id: UniqueIdentifier;
  children: TaskTreeItem[];
  collapsed?: boolean;
  kind: TaskTreeKind;
  /** Task note path (for kind=task) or parent note path (for kind=sub). */
  path: string;
  /** Index path into parent note's subtasks tree; only for kind=sub. */
  subIndexPath?: number[];
  title: string;
  status: TaskStatus;
  priority?: TaskPriority | null;
  due?: string | null;
  commentCount?: number;
  subtaskDone?: number;
  subtaskTotal?: number;
};

export type TaskTreeItems = TaskTreeItem[];

export type FlattenedTaskItem = TaskTreeItem & {
  parentId: UniqueIdentifier | null;
  depth: number;
  index: number;
};

export type TaskTreeSensorContext = MutableRefObject<{
  items: FlattenedTaskItem[];
  offset: number;
}>;

export function taskTreeId(path: string): string {
  return `task:${path}`;
}

export function subTreeId(parentPath: string, indexPath: number[]): string {
  return `sub:${parentPath}:${indexPath.join(".")}`;
}

export function parseTaskTreeId(
  id: UniqueIdentifier,
):
  | { kind: "task"; path: string }
  | { kind: "sub"; path: string; subIndexPath: number[] }
  | null {
  const s = String(id);
  if (s.startsWith("task:")) {
    return { kind: "task", path: s.slice("task:".length) };
  }
  if (s.startsWith("sub:")) {
    const rest = s.slice("sub:".length);
    const colon = rest.lastIndexOf(":");
    if (colon < 0) return null;
    const path = rest.slice(0, colon);
    const idx = rest
      .slice(colon + 1)
      .split(".")
      .map((n) => Number(n));
    if (idx.some((n) => !Number.isFinite(n))) return null;
    return { kind: "sub", path, subIndexPath: idx };
  }
  return null;
}

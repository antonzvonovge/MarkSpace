/** Sidebar Tasks section UI prefs (localStorage). */

import type { TasksFilters, TasksViewId } from "./taskNotes";
import { emptyTasksFilters } from "./taskNotes";

const COLLAPSED_KEY = "markspace-tasks-section-collapsed-v1";
const GROUPS_COLLAPSED_KEY = "markspace-tasks-groups-collapsed-v1";
const VIEW_KEY = "markspace-tasks-view-v1";
const FILTERS_KEY = "markspace-tasks-filters-v1";
const EXPANDED_KEY = "markspace-tasks-expanded-v1";

const VIEWS: TasksViewId[] = ["inbox", "today", "all", "filters"];

export function loadTasksSectionCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveTasksSectionCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Collapsed task list group ids in the sidebar. */
export function loadTasksGroupsCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(GROUPS_COLLAPSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function saveTasksGroupsCollapsed(ids: readonly string[]): void {
  try {
    localStorage.setItem(GROUPS_COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export function loadTasksView(): TasksViewId {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw && (VIEWS as string[]).includes(raw)) return raw as TasksViewId;
  } catch {
    // ignore
  }
  // Inbox shows undated tasks; Today only shows items with due=today.
  return "inbox";
}

export function saveTasksView(view: TasksViewId): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // ignore
  }
}

export function loadTasksFilters(): TasksFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return emptyTasksFilters();
    const parsed = JSON.parse(raw) as Partial<TasksFilters>;
    const base = emptyTasksFilters();
    return {
      query: typeof parsed.query === "string" ? parsed.query : base.query,
      list: typeof parsed.list === "string" ? parsed.list : base.list,
      priority:
        parsed.priority === 1 ||
        parsed.priority === 2 ||
        parsed.priority === 3 ||
        parsed.priority === 4
          ? parsed.priority
          : "",
      label: typeof parsed.label === "string" ? parsed.label : base.label,
      status:
        parsed.status === "done" ||
        parsed.status === "all" ||
        parsed.status === "open"
          ? parsed.status
          : base.status,
    };
  } catch {
    return emptyTasksFilters();
  }
}

export function saveTasksFilters(filters: TasksFilters): void {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // ignore
  }
}

/** Storage key for expanded parent tasks in the main Tasks list (per vault + view). */
export function tasksListContextKey(
  view: TasksViewId,
  list: string,
): string {
  if (view === "inbox") return "inbox";
  if (view === "today") return "today";
  if (view === "filters") return "filters";
  const named = list.trim();
  if (view === "all" && named) return `list:${named}`;
  return "all";
}

/** @deprecated Legacy flat list — migrated into vault-scoped map on first open. */
export function loadTasksExpandedPaths(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
  } catch {
    return [];
  }
}

export function saveTasksExpandedPaths(paths: readonly string[]): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...paths]));
  } catch {
    // ignore
  }
}

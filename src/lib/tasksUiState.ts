/** Sidebar Tasks section UI prefs (localStorage). */

import type { TasksFilters, TasksViewId } from "./taskNotes";
import { emptyTasksFilters } from "./taskNotes";

const COLLAPSED_KEY = "markspace-tasks-section-collapsed-v1";
const VIEW_KEY = "markspace-tasks-view-v1";
const FILTERS_KEY = "markspace-tasks-filters-v1";

const VIEWS: TasksViewId[] = ["inbox", "today", "upcoming", "all", "filters"];

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

export function loadTasksView(): TasksViewId {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw && (VIEWS as string[]).includes(raw)) return raw as TasksViewId;
  } catch {
    // ignore
  }
  return "today";
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

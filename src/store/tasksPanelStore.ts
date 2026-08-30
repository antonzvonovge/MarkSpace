import { create } from "zustand";
import type { TasksFilters, TasksViewId } from "../lib/taskNotes";
import {
  loadTasksExpandedPaths,
  loadTasksFilters,
  loadTasksView,
  saveTasksExpandedPaths,
  saveTasksFilters,
  saveTasksView,
} from "../lib/tasksUiState";

type TasksPanelStore = {
  view: TasksViewId;
  filters: TasksFilters;
  /** Task note paths whose children are shown. */
  expandedPaths: string[];
  /** Selected task path inside the Tasks panel (not a tab). */
  selectedPath: string | null;
  setView: (view: TasksViewId) => void;
  setFilters: (filters: TasksFilters) => void;
  patchFilters: (patch: Partial<TasksFilters>) => void;
  setExpandedPaths: (paths: string[]) => void;
  toggleExpandedPath: (path: string) => void;
  expandPath: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
};

export const useTasksPanelStore = create<TasksPanelStore>((set, get) => ({
  view: loadTasksView(),
  filters: loadTasksFilters(),
  expandedPaths: loadTasksExpandedPaths(),
  selectedPath: null,
  setView: (view) => {
    saveTasksView(view);
    set({ view });
  },
  setFilters: (filters) => {
    saveTasksFilters(filters);
    set({ filters });
  },
  patchFilters: (patch) => {
    const filters = { ...get().filters, ...patch };
    saveTasksFilters(filters);
    set({ filters });
  },
  setExpandedPaths: (paths) => {
    saveTasksExpandedPaths(paths);
    set({ expandedPaths: paths });
  },
  toggleExpandedPath: (path) => {
    const cur = get().expandedPaths;
    const next = cur.includes(path)
      ? cur.filter((p) => p !== path)
      : [...cur, path];
    saveTasksExpandedPaths(next);
    set({ expandedPaths: next });
  },
  expandPath: (path) => {
    const cur = get().expandedPaths;
    if (cur.includes(path)) return;
    const next = [...cur, path];
    saveTasksExpandedPaths(next);
    set({ expandedPaths: next });
  },
  setSelectedPath: (path) => set({ selectedPath: path }),
}));

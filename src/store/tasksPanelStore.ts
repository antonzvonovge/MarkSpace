import { create } from "zustand";
import type { TasksFilters, TasksViewId } from "../lib/taskNotes";
import {
  loadTasksFilters,
  loadTasksView,
  saveTasksFilters,
  saveTasksView,
} from "../lib/tasksUiState";

type TasksPanelStore = {
  view: TasksViewId;
  filters: TasksFilters;
  /** Selected task path inside the Tasks panel (not a tab). */
  selectedPath: string | null;
  setView: (view: TasksViewId) => void;
  setFilters: (filters: TasksFilters) => void;
  patchFilters: (patch: Partial<TasksFilters>) => void;
  setSelectedPath: (path: string | null) => void;
};

export const useTasksPanelStore = create<TasksPanelStore>((set, get) => ({
  view: loadTasksView(),
  filters: loadTasksFilters(),
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
  setSelectedPath: (path) => set({ selectedPath: path }),
}));

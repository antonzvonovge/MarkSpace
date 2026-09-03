import { create } from "zustand";
import type { TasksFilters, TasksViewId } from "../lib/taskNotes";
import {
  loadTasksExpandedMap,
  saveTasksExpandedMap,
} from "../lib/settingsStore";
import {
  loadTasksExpandedPaths,
  loadTasksFilters,
  loadTasksView,
  saveTasksFilters,
  saveTasksView,
  tasksListContextKey,
} from "../lib/tasksUiState";
import { useVaultStore } from "./vaultStore";

type TasksPanelStore = {
  view: TasksViewId;
  filters: TasksFilters;
  /** Task note paths whose children are shown in the current list context. */
  expandedPaths: string[];
  /** Selected task path inside the Tasks panel (not a tab). */
  selectedPath: string | null;
  /** Sidebar list under the pointer while dragging a task from the tree. */
  taskListDropTarget: string | null;
  /** Sidebar row highlight (list / smart view) without requiring the Tasks tab. */
  sidebarHighlight:
    | { kind: "view"; view: TasksViewId }
    | { kind: "list"; list: string }
    | null;
  hydrateExpandedForVault: (vaultPath: string) => Promise<void>;
  setView: (view: TasksViewId) => void;
  setFilters: (filters: TasksFilters) => void;
  patchFilters: (patch: Partial<TasksFilters>) => void;
  setExpandedPaths: (paths: string[]) => void;
  toggleExpandedPath: (path: string) => void;
  expandPath: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
  setTaskListDropTarget: (list: string | null) => void;
  setSidebarHighlight: (
    highlight:
      | { kind: "view"; view: TasksViewId }
      | { kind: "list"; list: string }
      | null,
  ) => void;
};

let expandedMapCache: Record<string, string[]> | null = null;
let expandedMapVault: string | null = null;

function contextKey(state: { view: TasksViewId; filters: TasksFilters }): string {
  return tasksListContextKey(state.view, state.filters.list);
}

function pathsForContext(
  map: Record<string, string[]>,
  key: string,
): string[] {
  return map[key] ?? [];
}

async function ensureExpandedMap(vaultPath: string): Promise<Record<string, string[]>> {
  if (expandedMapCache && expandedMapVault === vaultPath) {
    return expandedMapCache;
  }
  let map = await loadTasksExpandedMap(vaultPath);
  if (Object.keys(map).length === 0) {
    const legacy = loadTasksExpandedPaths();
    if (legacy.length > 0) {
      map = { inbox: [...legacy] };
      await saveTasksExpandedMap(vaultPath, map);
    }
  }
  expandedMapCache = map;
  expandedMapVault = vaultPath;
  return map;
}

function persistExpandedMap(vaultPath: string, map: Record<string, string[]>): void {
  expandedMapCache = map;
  expandedMapVault = vaultPath;
  void saveTasksExpandedMap(vaultPath, map);
}

function stashExpandedForContext(
  vaultPath: string,
  key: string,
  paths: readonly string[],
): Record<string, string[]> {
  const map = { ...(expandedMapCache ?? {}), [key]: [...paths] };
  persistExpandedMap(vaultPath, map);
  return map;
}

function switchExpandedContext(
  state: { view: TasksViewId; filters: TasksFilters; expandedPaths: string[] },
  nextView: TasksViewId,
  nextFilters: TasksFilters,
): string[] {
  const vaultPath = useVaultStore.getState().vaultPath;
  if (!vaultPath) return state.expandedPaths;

  const oldKey = contextKey(state);
  const newKey = tasksListContextKey(nextView, nextFilters.list);
  let map = expandedMapCache ?? {};
  map = { ...map, [oldKey]: [...state.expandedPaths] };
  persistExpandedMap(vaultPath, map);

  if (oldKey === newKey) return state.expandedPaths;
  return pathsForContext(map, newKey);
}

export const useTasksPanelStore = create<TasksPanelStore>((set, get) => ({
  view: loadTasksView(),
  filters: loadTasksFilters(),
  expandedPaths: [],
  selectedPath: null,
  taskListDropTarget: null,
  sidebarHighlight: null,

  hydrateExpandedForVault: async (vaultPath) => {
    const map = await ensureExpandedMap(vaultPath);
    const state = get();
    set({
      expandedPaths: pathsForContext(map, contextKey(state)),
    });
  },

  setView: (view) => {
    const state = get();
    const expandedPaths = switchExpandedContext(state, view, state.filters);
    saveTasksView(view);
    set({ view, expandedPaths });
  },

  setFilters: (filters) => {
    const state = get();
    const expandedPaths = switchExpandedContext(state, state.view, filters);
    saveTasksFilters(filters);
    set({ filters, expandedPaths });
  },

  patchFilters: (patch) => {
    const state = get();
    const filters = { ...state.filters, ...patch };
    const expandedPaths = switchExpandedContext(state, state.view, filters);
    saveTasksFilters(filters);
    set({ filters, expandedPaths });
  },

  setExpandedPaths: (paths) => {
    const vaultPath = useVaultStore.getState().vaultPath;
    const state = get();
    if (vaultPath) {
      stashExpandedForContext(vaultPath, contextKey(state), paths);
    }
    set({ expandedPaths: paths });
  },

  toggleExpandedPath: (path) => {
    const state = get();
    const cur = state.expandedPaths;
    const next = cur.includes(path)
      ? cur.filter((p) => p !== path)
      : [...cur, path];
    const vaultPath = useVaultStore.getState().vaultPath;
    if (vaultPath) {
      stashExpandedForContext(vaultPath, contextKey(state), next);
    }
    set({ expandedPaths: next });
  },

  expandPath: (path) => {
    const state = get();
    const cur = state.expandedPaths;
    if (cur.includes(path)) return;
    const next = [...cur, path];
    const vaultPath = useVaultStore.getState().vaultPath;
    if (vaultPath) {
      stashExpandedForContext(vaultPath, contextKey(state), next);
    }
    set({ expandedPaths: next });
  },

  setSelectedPath: (path) => set({ selectedPath: path }),
  setTaskListDropTarget: (taskListDropTarget) => set({ taskListDropTarget }),
  setSidebarHighlight: (sidebarHighlight) => set({ sidebarHighlight }),
}));

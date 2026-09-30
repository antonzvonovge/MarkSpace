import { create } from "zustand";
import {
  localDateYmd,
  reconcileTaskIndexCache,
  summarizeTaskListCounts,
  type TaskIndexEntry,
  type TaskListCount,
  type TaskListCounts,
} from "../lib/taskNotes";
import type { TreeNode } from "../lib/vaultApi";
import { useTasksPanelStore } from "./tasksPanelStore";

export const EMPTY_TASK_LIST_COUNT: TaskListCount = { total: 0, overdue: 0 };

const EMPTY_COUNTS: TaskListCounts = {
  byList: {},
  inbox: EMPTY_TASK_LIST_COUNT,
  today: EMPTY_TASK_LIST_COUNT,
  overdue: EMPTY_TASK_LIST_COUNT,
  filters: EMPTY_TASK_LIST_COUNT,
};

function reuseCount(
  prev: TaskListCount | undefined,
  next: TaskListCount,
): TaskListCount {
  if (prev && prev.total === next.total && prev.overdue === next.overdue) {
    return prev;
  }
  if (next.total === 0 && next.overdue === 0) return EMPTY_TASK_LIST_COUNT;
  return next;
}

function reuseCounts(prev: TaskListCounts, next: TaskListCounts): TaskListCounts {
  const byList: Record<string, TaskListCount> = {};
  let listsSame = Object.keys(prev.byList).length === Object.keys(next.byList).length;
  for (const key of Object.keys(next.byList)) {
    const reused = reuseCount(prev.byList[key], next.byList[key]!);
    byList[key] = reused;
    if (reused !== prev.byList[key]) listsSame = false;
  }
  if (listsSame) {
    for (const key of Object.keys(prev.byList)) {
      if (!(key in next.byList)) listsSame = false;
    }
  }

  const inbox = reuseCount(prev.inbox, next.inbox);
  const today = reuseCount(prev.today, next.today);
  const overdue = reuseCount(prev.overdue, next.overdue);
  const filters = reuseCount(prev.filters, next.filters);
  if (
    listsSame &&
    inbox === prev.inbox &&
    today === prev.today &&
    overdue === prev.overdue &&
    filters === prev.filters
  ) {
    return prev;
  }
  return {
    byList: listsSame ? prev.byList : byList,
    inbox,
    today,
    overdue,
    filters,
  };
}

type TaskListCountsStore = {
  entries: readonly TaskIndexEntry[];
  counts: TaskListCounts;
  /** Replace the cache from an index the Tasks panel already loaded. */
  publish: (entries: readonly TaskIndexEntry[]) => void;
  /** Recompute badges from the cache when Filters criteria change. */
  recompute: () => void;
  /**
   * While the Tasks tab is closed: compare task paths and read only new files.
   * In-flight work is dropped if `publish` runs.
   */
  syncFromTree: (tree: TreeNode | null | undefined) => Promise<void>;
};

let syncGen = 0;

function countsFor(entries: readonly TaskIndexEntry[]): TaskListCounts {
  const { view, filters } = useTasksPanelStore.getState();
  return summarizeTaskListCounts(entries, localDateYmd(), filters, view);
}

export const useTaskListCountsStore = create<TaskListCountsStore>((set, get) => ({
  entries: [],
  counts: EMPTY_COUNTS,

  publish: (entries) => {
    syncGen += 1;
    const counts = reuseCounts(get().counts, countsFor(entries));
    if (counts === get().counts && entries === get().entries) return;
    set({ entries, counts });
  },

  recompute: () => {
    const counts = reuseCounts(get().counts, countsFor(get().entries));
    if (counts !== get().counts) set({ counts });
  },

  syncFromTree: async (tree) => {
    const gen = ++syncGen;
    const prev = get().entries;
    const next = await reconcileTaskIndexCache(tree, prev);
    if (gen !== syncGen) return;
    if (next === prev) return;
    const counts = reuseCounts(get().counts, countsFor(next));
    set({ entries: next, counts });
  },
}));

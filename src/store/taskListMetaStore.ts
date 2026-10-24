import { create } from "zustand";
import {
  indexTaskListMeta,
  listTaskListGroups,
  listTaskListMeta,
  listTaskViewPrefs,
  type TaskListGroup,
  type TaskListMetaByName,
  type TaskViewPrefs,
} from "../lib/taskListMeta";
import type { TasksViewId } from "../lib/taskNotes";
import type { TaskGroupBy } from "../lib/taskGrouping";
import { parseTaskGroupBy } from "../lib/taskGrouping";

type TaskListMetaStore = {
  groups: TaskListGroup[];
  metaByName: TaskListMetaByName;
  viewPrefs: Partial<Record<TasksViewId, TaskViewPrefs>>;
  loaded: boolean;
  refresh: () => Promise<void>;
};

export function resolveTaskGroupBy(
  view: TasksViewId,
  filterList: string,
  metaByName: TaskListMetaByName,
  viewPrefs: Partial<Record<TasksViewId, TaskViewPrefs>>,
): TaskGroupBy {
  const list = filterList.trim();
  if (view === "all" && list) {
    return parseTaskGroupBy(metaByName[list]?.groupBy);
  }
  return parseTaskGroupBy(viewPrefs[view]?.groupBy);
}

export const useTaskListMetaStore = create<TaskListMetaStore>((set) => ({
  groups: [],
  metaByName: {},
  viewPrefs: {},
  loaded: false,
  refresh: async () => {
    const [groups, meta, viewPrefs] = await Promise.all([
      listTaskListGroups(),
      listTaskListMeta(),
      listTaskViewPrefs(),
    ]);
    set({
      groups,
      metaByName: indexTaskListMeta(meta),
      viewPrefs,
      loaded: true,
    });
  },
}));

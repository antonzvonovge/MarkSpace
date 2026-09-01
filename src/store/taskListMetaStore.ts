import { create } from "zustand";
import {
  indexTaskListMeta,
  listTaskListGroups,
  listTaskListMeta,
  type TaskListGroup,
  type TaskListMetaByName,
} from "../lib/taskListMeta";

type TaskListMetaStore = {
  groups: TaskListGroup[];
  metaByName: TaskListMetaByName;
  loaded: boolean;
  refresh: () => Promise<void>;
};

export const useTaskListMetaStore = create<TaskListMetaStore>((set) => ({
  groups: [],
  metaByName: {},
  loaded: false,
  refresh: async () => {
    const [groups, meta] = await Promise.all([
      listTaskListGroups(),
      listTaskListMeta(),
    ]);
    set({
      groups,
      metaByName: indexTaskListMeta(meta),
      loaded: true,
    });
  },
}));

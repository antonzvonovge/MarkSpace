/** Task list metadata (groups, colors) stored under `.markspace/task-lists/`. */

import { invoke } from "@tauri-apps/api/core";
import { normalizeProjectColor } from "./projectColors";
import { TASKS_FOLDER, joinPath } from "./vaultApi";

export type TaskListGroup = {
  id: string;
  name: string;
  order: number;
};

export type TaskListMeta = {
  /** Vault-relative path, e.g. `Tasks/Work`. */
  path: string;
  groupId: string;
  color: string;
  order: number;
};

export type TaskListMetaByName = Record<string, TaskListMeta>;

function normalizeMeta(raw: TaskListMeta): TaskListMeta {
  return {
    path: raw.path,
    groupId: (raw.groupId ?? "").trim(),
    color: normalizeProjectColor(raw.color),
    order: typeof raw.order === "number" ? raw.order : 0,
  };
}

export function taskListPath(name: string): string {
  return joinPath(TASKS_FOLDER, name);
}

export function taskListNameFromPath(path: string): string {
  const prefix = `${TASKS_FOLDER}/`;
  if (!path.startsWith(prefix)) return "";
  const rest = path.slice(prefix.length);
  if (!rest || rest.includes("/")) return "";
  return rest;
}

export async function listTaskListGroups(): Promise<TaskListGroup[]> {
  const raw = await invoke<TaskListGroup[]>("list_task_list_groups");
  return (raw ?? []).map((g) => ({
    id: g.id.trim(),
    name: g.name.trim(),
    order: g.order ?? 0,
  }));
}

export async function upsertTaskListGroup(
  id: string,
  name: string,
  order = 0,
): Promise<TaskListGroup> {
  const raw = await invoke<TaskListGroup>("upsert_task_list_group", {
    id,
    name,
    order,
  });
  return {
    id: raw.id.trim(),
    name: raw.name.trim(),
    order: raw.order ?? 0,
  };
}

export async function deleteTaskListGroup(id: string): Promise<void> {
  await invoke("delete_task_list_group", { id });
}

export async function getTaskListMeta(listName: string): Promise<TaskListMeta> {
  const raw = await invoke<TaskListMeta>("get_task_list_meta", {
    path: taskListPath(listName),
  });
  return normalizeMeta(raw);
}

export async function listTaskListMeta(): Promise<TaskListMeta[]> {
  const raw = await invoke<TaskListMeta[]>("list_task_list_meta");
  return (raw ?? []).map(normalizeMeta);
}

export async function setTaskListMeta(
  listName: string,
  patch: {
    groupId?: string;
    color?: string;
    order?: number;
  },
): Promise<TaskListMeta> {
  const current = await getTaskListMeta(listName);
  const raw = await invoke<TaskListMeta>("set_task_list_meta", {
    path: taskListPath(listName),
    groupId: patch.groupId ?? current.groupId,
    color: patch.color ?? current.color,
    order: patch.order ?? current.order,
  });
  return normalizeMeta(raw);
}

/** Map list folder name → meta (empty object when unset). */
export function indexTaskListMeta(
  items: readonly TaskListMeta[],
): TaskListMetaByName {
  const out: TaskListMetaByName = {};
  for (const item of items) {
    const name = taskListNameFromPath(item.path);
    if (name) out[name] = item;
  }
  return out;
}

export function taskListColor(
  metaByName: TaskListMetaByName,
  listName: string,
): string {
  return metaByName[listName]?.color ?? "";
}

export function taskListGroupId(
  metaByName: TaskListMetaByName,
  listName: string,
): string {
  return metaByName[listName]?.groupId ?? "";
}

export type SidebarListEntry = {
  name: string;
  groupId: string;
  color: string;
  order: number;
};

export type SidebarGroupSection = {
  group: TaskListGroup;
  lists: SidebarListEntry[];
};

/** Build grouped sidebar sections from tree list names + meta + groups. */
export function buildTaskListSidebar(
  listNames: readonly string[],
  groups: readonly TaskListGroup[],
  metaByName: TaskListMetaByName,
): { sections: SidebarGroupSection[]; ungrouped: SidebarListEntry[] } {
  const entries: SidebarListEntry[] = listNames.map((name) => ({
    name,
    groupId: taskListGroupId(metaByName, name),
    color: taskListColor(metaByName, name),
    order: metaByName[name]?.order ?? 0,
  }));

  const sortLists = (a: SidebarListEntry, b: SidebarListEntry) =>
    a.order - b.order ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const byGroup = new Map<string, SidebarListEntry[]>();
  const ungrouped: SidebarListEntry[] = [];

  for (const entry of entries) {
    if (entry.groupId && groupMap.has(entry.groupId)) {
      const list = byGroup.get(entry.groupId) ?? [];
      list.push(entry);
      byGroup.set(entry.groupId, list);
    } else {
      ungrouped.push(entry);
    }
  }

  const sections: SidebarGroupSection[] = [...groups]
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
    .map((group) => ({
      group,
      lists: (byGroup.get(group.id) ?? []).sort(sortLists),
    }));

  ungrouped.sort(sortLists);
  return { sections, ungrouped };
}

export function newTaskListGroupId(): string {
  return crypto.randomUUID();
}

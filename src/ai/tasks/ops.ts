/** Shared task operations for in-app agent tools and the MarkSpace MCP host. */

import { z } from "zod";
import {
  addTaskComment,
  collectTaskLabels,
  collectTaskLists,
  completeTask,
  createTaskList,
  createTaskNote,
  deleteTask,
  deleteTaskComment,
  deleteTaskList,
  emptyTasksFilters,
  filterTaskIndex,
  isTaskNotePath,
  isTaskUuid,
  isUnderTasksRoot,
  loadTaskIndex,
  loadTaskNote,
  localDateYmd,
  moveTaskToList,
  nestTaskAsSubtask,
  newTaskId,
  promoteTaskToRoot,
  renameTaskList,
  reorderTaskRelativeTo,
  saveTaskNote,
  updateTaskComment,
  type TaskPriority,
  type TasksViewId,
} from "../../lib/taskNotes";
import {
  deleteTaskListGroup,
  listTaskListGroups,
  listTaskListMeta,
  newTaskListGroupId,
  setTaskListMeta,
  upsertTaskListGroup,
} from "../../lib/taskListMeta";
import { useVaultStore } from "../../store/vaultStore";
import { TASK_NOTES_FORMAT_GUIDE } from "../taskNotesFormat";

export function fail(path: string | undefined, e: unknown) {
  return {
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
    ...(path ? { path } : {}),
  };
}

/** Number range — not z.literal unions (Gemini rejects numeric enum values). */
export function prioritySchema() {
  return z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Priority 1 (highest) – 4 (lowest)");
}

export function asTaskPriority(
  value: number | null | undefined,
): TaskPriority | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value >= 1 && value <= 4) return value as TaskPriority;
  return null;
}

export async function resolveTaskPath(opts: {
  path?: string;
  id?: string;
}): Promise<string> {
  const path = opts.path?.trim();
  if (path) {
    if (!isTaskNotePath(path) && !isUnderTasksRoot(path)) {
      throw new Error(`Not a Tasks/ note path: ${path}`);
    }
    return path.replace(/^\/+|\/+$/g, "");
  }
  const id = opts.id?.trim();
  if (!id) throw new Error("Provide path or id");
  const tree = useVaultStore.getState().tree;
  const index = await loadTaskIndex(tree);
  const hit = index.find((e) => e.id === id);
  if (!hit) throw new Error(`Task id not found in active index: ${id}`);
  return hit.path;
}

async function refreshTree() {
  await useVaultStore.getState().refreshTree();
}

function requireVaultOpen() {
  const { vaultPath, tree } = useVaultStore.getState();
  if (!vaultPath) throw new Error("No vault is open in MarkSpace");
  if (!tree) throw new Error("Vault tree is not ready");
}

// --- schemas ---

const emptySchema = z.object({});

const pathOrIdSchema = z.object({
  path: z.string().optional().describe("Vault-relative Tasks/… .md path"),
  id: z.string().optional().describe("Task UUID from frontmatter"),
});

const listTasksSchema = z.object({
  view: z
    .enum(["inbox", "today", "all", "filters"])
    .optional()
    .describe("Default filters (open tasks across lists when list empty)"),
  list: z.string().optional().describe("List/project name, e.g. Inbox or Work"),
  status: z.enum(["open", "done", "all"]).optional().describe("Default open"),
  priority: prioritySchema(),
  label: z.string().optional().describe("Exact label match"),
  query: z.string().optional().describe("Substring over title/list/labels/due"),
  limit: z.number().int().min(1).max(200).optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  list: z
    .string()
    .optional()
    .describe("List folder under Tasks/; default Inbox"),
  due: z.string().nullable().optional().describe("YYYY-MM-DD or null"),
  priority: prioritySchema(),
  labels: z.array(z.string()).optional(),
  parent: z
    .string()
    .nullable()
    .optional()
    .describe("Parent task UUID for a subtask"),
  description: z.string().optional(),
  comments: z.array(z.string()).optional().describe("Comment bodies to append"),
});

const createTasksSchema = z.object({
  list: z
    .string()
    .optional()
    .describe("Default list for items that omit list (default Inbox)"),
  tasks: z
    .array(
      z.object({
        ref: z
          .string()
          .optional()
          .describe(
            "Temporary id within this batch (e.g. t1); children use parent_ref",
          ),
        title: z.string().min(1),
        list: z.string().optional(),
        due: z.string().nullable().optional(),
        priority: prioritySchema(),
        labels: z.array(z.string()).optional(),
        parent: z
          .string()
          .nullable()
          .optional()
          .describe("Existing parent task UUID"),
        parent_ref: z
          .string()
          .optional()
          .describe("ref of a parent created in this same batch"),
        description: z.string().optional(),
        comments: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const updateTaskSchema = z.object({
  path: z.string().optional(),
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  due: z.string().nullable().optional(),
  priority: z
    .number()
    .int()
    .min(1)
    .max(4)
    .nullable()
    .optional()
    .describe("Priority 1–4, or null to clear"),
  labels: z.array(z.string()).optional(),
});

const moveTaskSchema = z.object({
  path: z.string().optional(),
  id: z.string().optional(),
  list: z.string().min(1).describe("Target list name, e.g. Work"),
});

const setParentSchema = z.object({
  path: z.string().optional().describe("Child task path"),
  id: z.string().optional().describe("Child task id"),
  parent_path: z
    .string()
    .nullable()
    .optional()
    .describe("Parent task path; null/omit with promote=true to clear"),
  promote: z
    .boolean()
    .optional()
    .describe("If true, clear parent (root). Ignores parent_path."),
});

const commentBodySchema = z.object({
  path: z.string().optional(),
  id: z.string().optional(),
  body: z.string().min(1),
});

const commentIndexSchema = z.object({
  path: z.string().optional(),
  id: z.string().optional(),
  index: z.number().int().min(0).describe("0-based comment index"),
  body: z.string().min(1).optional(),
});

const reorderSchema = z.object({
  path: z.string().optional(),
  id: z.string().optional(),
  target_path: z.string().optional().describe("Sibling task path to place relative to"),
  target_id: z.string().optional().describe("Sibling task id"),
  place: z.enum(["before", "after"]).describe("Place before or after target"),
});

const listNameSchema = z.object({ name: z.string().min(1) });

const renameListSchema = z.object({
  from: z.string().min(1).describe("Current list folder name"),
  to: z.string().min(1).describe("New list folder name"),
});

const setListMetaSchema = z.object({
  name: z.string().min(1).describe("List folder name"),
  groupId: z.string().optional().describe("Sidebar group id, or empty to ungroup"),
  color: z.string().optional().describe("Material 500 hex, or empty to clear"),
  order: z.number().int().optional(),
});

const upsertGroupSchema = z.object({
  id: z.string().optional().describe("Existing group id; omit to create"),
  name: z.string().min(1),
  order: z.number().int().optional(),
});

const groupIdSchema = z.object({ id: z.string().min(1) });

// --- ops ---

export async function opReadTaskFormat() {
  return { guide: TASK_NOTES_FORMAT_GUIDE };
}

export async function opListTaskLists() {
  requireVaultOpen();
  const tree = useVaultStore.getState().tree;
  return { ok: true as const, lists: collectTaskLists(tree) };
}

export async function opListTaskLabels() {
  try {
    requireVaultOpen();
    const tree = useVaultStore.getState().tree;
    const index = await loadTaskIndex(tree);
    return { ok: true as const, labels: collectTaskLabels(index) };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opListTasks(input: z.infer<typeof listTasksSchema>) {
  const {
    view = "filters",
    list = "",
    status = "open",
    priority,
    label = "",
    query = "",
    limit = 80,
  } = input;
  try {
    requireVaultOpen();
    const tree = useVaultStore.getState().tree;
    const index = await loadTaskIndex(tree);
    const filters = {
      ...emptyTasksFilters(),
      list: list.trim(),
      status,
      priority: (priority ?? "") as TaskPriority | "",
      label: label.trim(),
      query: query.trim(),
    };
    const rows = filterTaskIndex(
      index,
      view as TasksViewId,
      filters,
      localDateYmd(),
    ).slice(0, limit);
    return {
      ok: true as const,
      count: rows.length,
      tasks: rows.map((e) => ({
        path: e.path,
        id: e.id,
        title: e.title,
        list: e.list,
        status: e.status,
        due: e.due,
        priority: e.priority,
        labels: e.labels,
        parent: e.parent,
        subtaskTotal: e.subtaskTotal,
        subtaskDone: e.subtaskDone,
        commentCount: e.commentCount,
      })),
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opGetTask(input: z.infer<typeof pathOrIdSchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const note = await loadTaskNote(p);
    return {
      ok: true as const,
      path: note.path,
      title: note.title,
      attrs: note.attrs,
      description: note.description,
      comments: note.comments,
      checklistSubtasks: note.subtasks,
    };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opCreateTask(input: z.infer<typeof createTaskSchema>) {
  try {
    requireVaultOpen();
    const created = await createTaskNote({
      title: input.title,
      list: input.list,
      due: input.due === undefined ? null : input.due,
      priority: asTaskPriority(input.priority) ?? null,
      labels: input.labels,
      parent: input.parent ?? null,
      description: input.description,
      comments: input.comments,
    });
    await refreshTree();
    const note = await loadTaskNote(created);
    return {
      ok: true as const,
      path: created,
      id: note.attrs.id,
      changedPaths: [created],
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opCreateTasks(input: z.infer<typeof createTasksSchema>) {
  try {
    requireVaultOpen();
    const defaultList = input.list;
    const tasks = input.tasks;
    const refToId = new Map<string, string>();
    for (const item of tasks) {
      const ref = item.ref?.trim();
      if (!ref) continue;
      if (refToId.has(ref)) {
        return fail(undefined, `Duplicate ref in batch: ${ref}`);
      }
      refToId.set(ref, newTaskId());
    }

    const created: Array<{
      ref?: string;
      path: string;
      id: string;
      title: string;
      parent: string | null;
    }> = [];
    const changedPaths: string[] = [];
    const errors: Array<{ title: string; error: string }> = [];

    for (const item of tasks) {
      const ref = item.ref?.trim();
      const id = (ref && refToId.get(ref)) || newTaskId();
      let parent: string | null = null;
      const parentRef = item.parent_ref?.trim();
      if (parentRef) {
        const resolved = refToId.get(parentRef);
        if (!resolved) {
          errors.push({
            title: item.title,
            error: `Unknown parent_ref: ${parentRef}`,
          });
          continue;
        }
        parent = resolved;
      } else if (item.parent && isTaskUuid(item.parent)) {
        parent = item.parent;
      }

      try {
        const path = await createTaskNote({
          title: item.title,
          list: item.list?.trim() || defaultList,
          due: item.due === undefined ? null : item.due,
          priority: asTaskPriority(item.priority) ?? null,
          labels: item.labels,
          parent,
          id,
          description: item.description,
          comments: item.comments,
        });
        created.push({
          ...(ref ? { ref } : {}),
          path,
          id,
          title: item.title.trim() || "Untitled",
          parent,
        });
        changedPaths.push(path);
      } catch (e) {
        errors.push({
          title: item.title,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    await refreshTree();
    return {
      ok: errors.length === 0,
      count: created.length,
      created,
      changedPaths,
      ...(errors.length ? { errors } : {}),
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opUpdateTask(input: z.infer<typeof updateTaskSchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const note = await loadTaskNote(p);
    const nextPriority = asTaskPriority(input.priority);
    const next = {
      ...note,
      title:
        input.title !== undefined
          ? input.title.trim() || note.title
          : note.title,
      description:
        input.description !== undefined ? input.description : note.description,
      attrs: {
        ...note.attrs,
        due: input.due === undefined ? note.attrs.due : input.due,
        priority:
          nextPriority === undefined ? note.attrs.priority : nextPriority,
        labels: input.labels !== undefined ? input.labels : note.attrs.labels,
      },
    };
    await saveTaskNote(next);
    await refreshTree();
    return { ok: true as const, path: p, changedPaths: [p] };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opCompleteTask(input: z.infer<typeof pathOrIdSchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const tree = useVaultStore.getState().tree;
    const index = await loadTaskIndex(tree);
    const changedPaths = await completeTask(p, { tree, index });
    await refreshTree();
    return {
      ok: true as const,
      path: changedPaths[changedPaths.length - 1] ?? p,
      changedPaths,
    };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opDeleteTask(input: z.infer<typeof pathOrIdSchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const tree = useVaultStore.getState().tree;
    const index = await loadTaskIndex(tree);
    const deletedPaths = await deleteTask(p, { tree, index });
    await refreshTree();
    return { ok: true as const, deletedPaths, changedPaths: deletedPaths };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opMoveTaskToList(input: z.infer<typeof moveTaskSchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const next = await moveTaskToList(p, input.list, {
      tree: useVaultStore.getState().tree,
    });
    await refreshTree();
    return {
      ok: true as const,
      path: next,
      changedPaths: next === p ? [p] : [p, next],
    };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opSetTaskParent(input: z.infer<typeof setParentSchema>) {
  try {
    requireVaultOpen();
    const child = await resolveTaskPath(input);
    const tree = useVaultStore.getState().tree;
    const index = await loadTaskIndex(tree);
    if (input.promote || input.parent_path == null || input.parent_path === "") {
      await promoteTaskToRoot(child);
    } else {
      await nestTaskAsSubtask(input.parent_path, child, index);
    }
    await refreshTree();
    return { ok: true as const, path: child, changedPaths: [child] };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opReorderTask(input: z.infer<typeof reorderSchema>) {
  try {
    requireVaultOpen();
    const from = await resolveTaskPath(input);
    const target = await resolveTaskPath({
      path: input.target_path,
      id: input.target_id,
    });
    const tree = useVaultStore.getState().tree;
    await reorderTaskRelativeTo(from, target, input.place, tree);
    await refreshTree();
    return {
      ok: true as const,
      path: from,
      target,
      place: input.place,
      changedPaths: [from],
    };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opAddTaskComment(input: z.infer<typeof commentBodySchema>) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    await addTaskComment(p, input.body);
    await refreshTree();
    return { ok: true as const, path: p, changedPaths: [p] };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opUpdateTaskComment(
  input: z.infer<typeof commentIndexSchema>,
) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    const body = input.body?.trim();
    if (!body) throw new Error("Comment body is required");
    await updateTaskComment(p, input.index, body);
    await refreshTree();
    return { ok: true as const, path: p, index: input.index, changedPaths: [p] };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opDeleteTaskComment(
  input: z.infer<typeof commentIndexSchema>,
) {
  try {
    requireVaultOpen();
    const p = await resolveTaskPath(input);
    await deleteTaskComment(p, input.index);
    await refreshTree();
    return { ok: true as const, path: p, index: input.index, changedPaths: [p] };
  } catch (e) {
    return fail(input.path, e);
  }
}

export async function opCreateTaskList(input: z.infer<typeof listNameSchema>) {
  try {
    requireVaultOpen();
    const list = await createTaskList(input.name);
    await refreshTree();
    return {
      ok: true as const,
      list,
      path: `Tasks/${list}`,
      changedPaths: [`Tasks/${list}`],
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opRenameTaskList(input: z.infer<typeof renameListSchema>) {
  try {
    requireVaultOpen();
    const list = await renameTaskList(input.from, input.to);
    await refreshTree();
    return {
      ok: true as const,
      list,
      path: `Tasks/${list}`,
      changedPaths: [`Tasks/${input.from}`, `Tasks/${list}`],
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opDeleteTaskList(input: z.infer<typeof listNameSchema>) {
  try {
    requireVaultOpen();
    const list = await deleteTaskList(input.name);
    await refreshTree();
    return {
      ok: true as const,
      list,
      changedPaths: [`Tasks/${list}`],
    };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opListTaskListMeta() {
  try {
    requireVaultOpen();
    const meta = await listTaskListMeta();
    return { ok: true as const, meta };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opSetTaskListMeta(input: z.infer<typeof setListMetaSchema>) {
  try {
    requireVaultOpen();
    const meta = await setTaskListMeta(input.name, {
      groupId: input.groupId,
      color: input.color,
      order: input.order,
    });
    return { ok: true as const, meta };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opListTaskListGroups() {
  try {
    requireVaultOpen();
    const groups = await listTaskListGroups();
    return { ok: true as const, groups };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opUpsertTaskListGroup(
  input: z.infer<typeof upsertGroupSchema>,
) {
  try {
    requireVaultOpen();
    const id = input.id?.trim() || newTaskListGroupId();
    const group = await upsertTaskListGroup(id, input.name, input.order ?? 0);
    return { ok: true as const, group };
  } catch (e) {
    return fail(undefined, e);
  }
}

export async function opDeleteTaskListGroup(input: z.infer<typeof groupIdSchema>) {
  try {
    requireVaultOpen();
    await deleteTaskListGroup(input.id);
    return { ok: true as const, id: input.id };
  } catch (e) {
    return fail(undefined, e);
  }
}

// --- MCP tool registry ---

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

function schemaJson(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  // MCP expects a plain object schema; drop $schema noise.
  const { $schema: _, ...rest } = raw;
  return rest;
}

export const TASK_MCP_TOOL_DEFS: McpToolDef[] = [
  {
    name: "read_task_format",
    description:
      "Read the MarkSpace Tasks/ note format guide (frontmatter, nesting, completed archive). Call when unsure.",
    inputSchema: schemaJson(emptySchema),
  },
  {
    name: "list_task_lists",
    description:
      "List task list folder names under Tasks/ (Inbox, Work, …). Excludes the completed archive folder.",
    inputSchema: schemaJson(emptySchema),
  },
  {
    name: "list_task_labels",
    description:
      "List known task labels from the active (non-archived) task index.",
    inputSchema: schemaJson(emptySchema),
  },
  {
    name: "list_tasks",
    description:
      "List active tasks (skips Tasks/<list>/completed/). Filter like the Tasks UI: view inbox|today|all|filters plus list/status/priority/label/query.",
    inputSchema: schemaJson(listTasksSchema),
  },
  {
    name: "get_task",
    description:
      "Load one task note by path or id (title, attrs, description, comments). Prefer path when known.",
    inputSchema: schemaJson(pathOrIdSchema),
  },
  {
    name: "create_task",
    description:
      "Create one task under Tasks/<list>/. For several tasks (imports), use create_tasks instead.",
    inputSchema: schemaJson(createTaskSchema),
  },
  {
    name: "create_tasks",
    description:
      "Create many tasks in one call (imports). Use ref + parent_ref to link parents/children inside the batch without knowing UUIDs yet.",
    inputSchema: schemaJson(createTasksSchema),
  },
  {
    name: "update_task",
    description:
      "Update title, description, due, priority, and/or labels. Do not use for complete — call complete_task instead.",
    inputSchema: schemaJson(updateTaskSchema),
  },
  {
    name: "complete_task",
    description:
      "Mark a task done and move it to Tasks/<list>/completed/. Completing a parent also completes and archives all child task files.",
    inputSchema: schemaJson(pathOrIdSchema),
  },
  {
    name: "delete_task",
    description:
      "Permanently delete a task note and its file children. Cannot be undone.",
    inputSchema: schemaJson(pathOrIdSchema),
  },
  {
    name: "move_task_to_list",
    description:
      "Move a task note into another Tasks/<list>/ folder. File children move with it.",
    inputSchema: schemaJson(moveTaskSchema),
  },
  {
    name: "set_task_parent",
    description:
      "Nest a task under a parent (parent UUID via parent_path) or promote to root (clear parent). Max two levels.",
    inputSchema: schemaJson(setParentSchema),
  },
  {
    name: "reorder_task",
    description:
      "Reorder a task before/after another sibling in the same list folder (vault order.json).",
    inputSchema: schemaJson(reorderSchema),
  },
  {
    name: "add_task_comment",
    description: "Append a ## Comments block (local timestamp) to a task note.",
    inputSchema: schemaJson(commentBodySchema),
  },
  {
    name: "update_task_comment",
    description: "Replace the body of an existing comment by 0-based index.",
    inputSchema: schemaJson(
      commentIndexSchema.extend({ body: z.string().min(1) }),
    ),
  },
  {
    name: "delete_task_comment",
    description: "Delete a comment by 0-based index.",
    inputSchema: schemaJson(
      z.object({
        path: z.string().optional(),
        id: z.string().optional(),
        index: z.number().int().min(0),
      }),
    ),
  },
  {
    name: "create_task_list",
    description:
      "Create a new list folder under Tasks/ (not Inbox, not completed).",
    inputSchema: schemaJson(listNameSchema),
  },
  {
    name: "rename_task_list",
    description: "Rename a list folder under Tasks/ (Inbox cannot be renamed).",
    inputSchema: schemaJson(renameListSchema),
  },
  {
    name: "delete_task_list",
    description:
      "Delete a list folder and all of its tasks (Inbox cannot be deleted).",
    inputSchema: schemaJson(listNameSchema),
  },
  {
    name: "list_task_list_meta",
    description: "List sidebar metadata for task lists (groupId, color, order).",
    inputSchema: schemaJson(emptySchema),
  },
  {
    name: "set_task_list_meta",
    description: "Set group, color, and/or order for a task list.",
    inputSchema: schemaJson(setListMetaSchema),
  },
  {
    name: "list_task_list_groups",
    description: "List sidebar groups for task lists.",
    inputSchema: schemaJson(emptySchema),
  },
  {
    name: "upsert_task_list_group",
    description: "Create or update a sidebar group for task lists.",
    inputSchema: schemaJson(upsertGroupSchema),
  },
  {
    name: "delete_task_list_group",
    description:
      "Delete a sidebar group. Lists in that group become ungrouped.",
    inputSchema: schemaJson(groupIdSchema),
  },
];

export async function dispatchTaskTool(
  name: string,
  args: unknown,
): Promise<unknown> {
  switch (name) {
    case "read_task_format":
      return opReadTaskFormat();
    case "list_task_lists":
      return opListTaskLists();
    case "list_task_labels":
      return opListTaskLabels();
    case "list_tasks":
      return opListTasks(listTasksSchema.parse(args ?? {}));
    case "get_task":
      return opGetTask(pathOrIdSchema.parse(args ?? {}));
    case "create_task":
      return opCreateTask(createTaskSchema.parse(args ?? {}));
    case "create_tasks":
      return opCreateTasks(createTasksSchema.parse(args ?? {}));
    case "update_task":
      return opUpdateTask(updateTaskSchema.parse(args ?? {}));
    case "complete_task":
      return opCompleteTask(pathOrIdSchema.parse(args ?? {}));
    case "delete_task":
      return opDeleteTask(pathOrIdSchema.parse(args ?? {}));
    case "move_task_to_list":
      return opMoveTaskToList(moveTaskSchema.parse(args ?? {}));
    case "set_task_parent":
      return opSetTaskParent(setParentSchema.parse(args ?? {}));
    case "reorder_task":
      return opReorderTask(reorderSchema.parse(args ?? {}));
    case "add_task_comment":
      return opAddTaskComment(commentBodySchema.parse(args ?? {}));
    case "update_task_comment":
      return opUpdateTaskComment(
        commentIndexSchema.extend({ body: z.string().min(1) }).parse(args ?? {}),
      );
    case "delete_task_comment":
      return opDeleteTaskComment(
        z
          .object({
            path: z.string().optional(),
            id: z.string().optional(),
            index: z.number().int().min(0),
          })
          .parse(args ?? {}),
      );
    case "create_task_list":
      return opCreateTaskList(listNameSchema.parse(args ?? {}));
    case "rename_task_list":
      return opRenameTaskList(renameListSchema.parse(args ?? {}));
    case "delete_task_list":
      return opDeleteTaskList(listNameSchema.parse(args ?? {}));
    case "list_task_list_meta":
      return opListTaskListMeta();
    case "set_task_list_meta":
      return opSetTaskListMeta(setListMetaSchema.parse(args ?? {}));
    case "list_task_list_groups":
      return opListTaskListGroups();
    case "upsert_task_list_group":
      return opUpsertTaskListGroup(upsertGroupSchema.parse(args ?? {}));
    case "delete_task_list_group":
      return opDeleteTaskListGroup(groupIdSchema.parse(args ?? {}));
    default:
      throw new Error(`Unknown task tool: ${name}`);
  }
}

/** Schemas re-exported for agent tool wiring. */
export const taskToolSchemas = {
  emptySchema,
  pathOrIdSchema,
  listTasksSchema,
  createTaskSchema,
  createTasksSchema,
  updateTaskSchema,
  moveTaskSchema,
  setParentSchema,
  commentBodySchema,
  commentIndexSchema,
  reorderSchema,
  listNameSchema,
  renameListSchema,
  setListMetaSchema,
  upsertGroupSchema,
  groupIdSchema,
  prioritySchema,
};

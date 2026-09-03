import { tool } from "ai";
import type { ChatMode } from "../types";
import {
  opAddTaskComment,
  opCompleteTask,
  opCreateTask,
  opCreateTaskList,
  opCreateTasks,
  opDeleteTask,
  opDeleteTaskComment,
  opDeleteTaskList,
  opDeleteTaskListGroup,
  opGetTask,
  opListTaskLabels,
  opListTaskListGroups,
  opListTaskListMeta,
  opListTaskLists,
  opListTasks,
  opMoveTaskToList,
  opReadTaskFormat,
  opRenameTaskList,
  opReorderTask,
  opSetTaskListMeta,
  opSetTaskParent,
  opUpdateTask,
  opUpdateTaskComment,
  opUpsertTaskListGroup,
  taskToolSchemas,
} from "./ops";

const {
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
} = taskToolSchemas;

export function buildTasksTools(mode: ChatMode) {
  const readTools = {
    read_task_format: tool({
      description:
        "Read the MarkSpace Tasks/ note format guide (frontmatter, nesting, completed archive). Call when unsure.",
      inputSchema: emptySchema,
      execute: async () => opReadTaskFormat(),
    }),

    list_task_lists: tool({
      description:
        "List task list folder names under Tasks/ (Inbox, Work, …). Excludes the completed archive folder.",
      inputSchema: emptySchema,
      execute: async () => opListTaskLists(),
    }),

    list_task_labels: tool({
      description:
        "List known task labels from the active (non-archived) task index.",
      inputSchema: emptySchema,
      execute: async () => opListTaskLabels(),
    }),

    list_tasks: tool({
      description:
        "List active tasks (skips Tasks/<list>/completed/). Filter like the Tasks UI: view inbox|today|all|filters plus list/status/priority/label/query.",
      inputSchema: listTasksSchema,
      execute: async (input) => opListTasks(input),
    }),

    get_task: tool({
      description:
        "Load one task note by path or id (title, attrs, description, comments). Prefer path when known.",
      inputSchema: pathOrIdSchema,
      execute: async (input) => opGetTask(input),
    }),
  };

  if (mode === "ask") return readTools;

  return {
    ...readTools,

    create_task: tool({
      description:
        "Create one task under Tasks/<list>/. For several tasks (imports), use create_tasks instead.",
      inputSchema: createTaskSchema,
      execute: async (input) => opCreateTask(input),
    }),

    create_tasks: tool({
      description:
        "Create many tasks in one call (imports). Use ref + parent_ref to link parents/children inside the batch without knowing UUIDs yet. Prefer this over repeated create_task.",
      inputSchema: createTasksSchema,
      execute: async (input) => opCreateTasks(input),
    }),

    update_task: tool({
      description:
        "Update title, description, due, priority, and/or labels. Do not use for complete — call complete_task instead.",
      inputSchema: updateTaskSchema,
      execute: async (input) => opUpdateTask(input),
    }),

    complete_task: tool({
      description:
        "Mark a task done and move it to Tasks/<list>/completed/. Completing a parent also completes and archives all child task files.",
      inputSchema: pathOrIdSchema,
      execute: async (input) => opCompleteTask(input),
    }),

    delete_task: tool({
      description:
        "Permanently delete a task note and its file children. Cannot be undone.",
      inputSchema: pathOrIdSchema,
      execute: async (input) => opDeleteTask(input),
    }),

    move_task_to_list: tool({
      description:
        "Move a task note into another Tasks/<list>/ folder (active list root). File children (parent = this task's id) move with it.",
      inputSchema: moveTaskSchema,
      execute: async (input) => opMoveTaskToList(input),
    }),

    set_task_parent: tool({
      description:
        "Nest a task under a parent (parent UUID via parent_path) or promote to root (clear parent). Max two levels.",
      inputSchema: setParentSchema,
      execute: async (input) => opSetTaskParent(input),
    }),

    reorder_task: tool({
      description:
        "Reorder a task before/after another sibling in the same list folder (vault order.json).",
      inputSchema: reorderSchema,
      execute: async (input) => opReorderTask(input),
    }),

    add_task_comment: tool({
      description: "Append a ## Comments block (local timestamp) to a task note.",
      inputSchema: commentBodySchema,
      execute: async (input) => opAddTaskComment(input),
    }),

    update_task_comment: tool({
      description: "Replace the body of an existing comment by 0-based index.",
      inputSchema: commentIndexSchema.extend({
        body: commentBodySchema.shape.body,
      }),
      execute: async (input) => opUpdateTaskComment(input),
    }),

    delete_task_comment: tool({
      description: "Delete a comment by 0-based index.",
      inputSchema: pathOrIdSchema.extend({
        index: commentIndexSchema.shape.index,
      }),
      execute: async (input) => opDeleteTaskComment(input),
    }),

    create_task_list: tool({
      description:
        "Create a new list folder under Tasks/ (not Inbox, not completed).",
      inputSchema: listNameSchema,
      execute: async (input) => opCreateTaskList(input),
    }),

    rename_task_list: tool({
      description: "Rename a list folder under Tasks/ (Inbox cannot be renamed).",
      inputSchema: renameListSchema,
      execute: async (input) => opRenameTaskList(input),
    }),

    delete_task_list: tool({
      description:
        "Delete a list folder and all of its tasks (Inbox cannot be deleted).",
      inputSchema: listNameSchema,
      execute: async (input) => opDeleteTaskList(input),
    }),

    list_task_list_meta: tool({
      description: "List sidebar metadata for task lists (groupId, color, order).",
      inputSchema: emptySchema,
      execute: async () => opListTaskListMeta(),
    }),

    set_task_list_meta: tool({
      description: "Set group, color, and/or order for a task list.",
      inputSchema: setListMetaSchema,
      execute: async (input) => opSetTaskListMeta(input),
    }),

    list_task_list_groups: tool({
      description: "List sidebar groups for task lists.",
      inputSchema: emptySchema,
      execute: async () => opListTaskListGroups(),
    }),

    upsert_task_list_group: tool({
      description: "Create or update a sidebar group for task lists.",
      inputSchema: upsertGroupSchema,
      execute: async (input) => opUpsertTaskListGroup(input),
    }),

    delete_task_list_group: tool({
      description:
        "Delete a sidebar group. Lists in that group become ungrouped.",
      inputSchema: groupIdSchema,
      execute: async (input) => opDeleteTaskListGroup(input),
    }),
  };
}

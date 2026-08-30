import { tool } from "ai";
import { z } from "zod";
import {
  addTaskComment,
  collectTaskLabels,
  collectTaskLists,
  completeTask,
  createTaskList,
  createTaskNote,
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
  saveTaskNote,
  type TaskPriority,
  type TasksViewId,
} from "../../lib/taskNotes";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { TASK_NOTES_FORMAT_GUIDE } from "../taskNotesFormat";

function fail(path: string | undefined, e: unknown) {
  return {
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
    ...(path ? { path } : {}),
  };
}

/** Number range — not z.literal unions (Gemini rejects numeric enum values). */
function prioritySchema() {
  return z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("Priority 1 (highest) – 4 (lowest)");
}

function asTaskPriority(
  value: number | null | undefined,
): TaskPriority | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value >= 1 && value <= 4) return value as TaskPriority;
  return null;
}

async function resolveTaskPath(opts: {
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

export function buildTasksTools(mode: ChatMode) {
  const readTools = {
    read_task_format: tool({
      description:
        "Read the MarkSpace Tasks/ note format guide (frontmatter, nesting, completed archive). Call when unsure.",
      inputSchema: z.object({}),
      execute: async () => ({ guide: TASK_NOTES_FORMAT_GUIDE }),
    }),

    list_task_lists: tool({
      description:
        "List task list folder names under Tasks/ (Inbox, Work, …). Excludes the completed archive folder.",
      inputSchema: z.object({}),
      execute: async () => {
        const tree = useVaultStore.getState().tree;
        return { ok: true as const, lists: collectTaskLists(tree) };
      },
    }),

    list_task_labels: tool({
      description:
        "List known task labels from the active (non-archived) task index.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const tree = useVaultStore.getState().tree;
          const index = await loadTaskIndex(tree);
          return { ok: true as const, labels: collectTaskLabels(index) };
        } catch (e) {
          return fail(undefined, e);
        }
      },
    }),

    list_tasks: tool({
      description:
        "List active tasks (skips Tasks/<list>/completed/). Filter like the Tasks UI: view inbox|today|all|filters plus list/status/priority/label/query.",
      inputSchema: z.object({
        view: z
          .enum(["inbox", "today", "all", "filters"])
          .optional()
          .describe("Default filters (open tasks across lists when list empty)"),
        list: z
          .string()
          .optional()
          .describe("List/project name, e.g. Inbox or Work"),
        status: z
          .enum(["open", "done", "all"])
          .optional()
          .describe("Default open"),
        priority: prioritySchema(),
        label: z.string().optional().describe("Exact label match"),
        query: z.string().optional().describe("Substring over title/list/labels/due"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async ({
        view = "filters",
        list = "",
        status = "open",
        priority,
        label = "",
        query = "",
        limit = 80,
      }) => {
        try {
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
          const viewId = view as TasksViewId;
          const rows = filterTaskIndex(
            index,
            viewId,
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
      },
    }),

    get_task: tool({
      description:
        "Load one task note by path or id (title, attrs, description, comments). Prefer path when known.",
      inputSchema: z.object({
        path: z.string().optional().describe("Vault-relative Tasks/… .md path"),
        id: z.string().optional().describe("Task UUID from frontmatter"),
      }),
      execute: async ({ path, id }) => {
        try {
          const p = await resolveTaskPath({ path, id });
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
          return fail(path, e);
        }
      },
    }),
  };

  if (mode === "ask") return readTools;

  return {
    ...readTools,

    create_task: tool({
      description:
        "Create one task under Tasks/<list>/. For several tasks (imports), use create_tasks instead.",
      inputSchema: z.object({
        title: z.string().min(1),
        list: z
          .string()
          .optional()
          .describe("List folder under Tasks/; default Inbox"),
        due: z
          .string()
          .nullable()
          .optional()
          .describe("YYYY-MM-DD or null"),
        priority: prioritySchema(),
        labels: z.array(z.string()).optional(),
        parent: z
          .string()
          .nullable()
          .optional()
          .describe("Parent task UUID for a subtask"),
        description: z.string().optional(),
        comments: z
          .array(z.string())
          .optional()
          .describe("Comment bodies to append"),
      }),
      execute: async ({
        title,
        list,
        due,
        priority,
        labels,
        parent,
        description,
        comments,
      }) => {
        try {
          const created = await createTaskNote({
            title,
            list,
            due: due === undefined ? null : due,
            priority: asTaskPriority(priority) ?? null,
            labels,
            parent: parent ?? null,
            description,
            comments,
          });
          await useVaultStore.getState().refreshTree();
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
      },
    }),

    create_tasks: tool({
      description:
        "Create many tasks in one call (imports). Use ref + parent_ref to link parents/children inside the batch without knowing UUIDs yet. Prefer this over repeated create_task.",
      inputSchema: z.object({
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
      }),
      execute: async ({ list: defaultList, tasks }) => {
        try {
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

          await useVaultStore.getState().refreshTree();
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
      },
    }),

    update_task: tool({
      description:
        "Update title, description, due, priority, and/or labels. Do not use for complete — call complete_task instead.",
      inputSchema: z.object({
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
      }),
      execute: async ({
        path,
        id,
        title,
        description,
        due,
        priority,
        labels,
      }) => {
        try {
          const p = await resolveTaskPath({ path, id });
          const note = await loadTaskNote(p);
          const nextPriority = asTaskPriority(priority);
          const next = {
            ...note,
            title: title !== undefined ? title.trim() || note.title : note.title,
            description:
              description !== undefined ? description : note.description,
            attrs: {
              ...note.attrs,
              due: due === undefined ? note.attrs.due : due,
              priority:
                nextPriority === undefined
                  ? note.attrs.priority
                  : nextPriority,
              labels: labels !== undefined ? labels : note.attrs.labels,
            },
          };
          await saveTaskNote(next);
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: p, changedPaths: [p] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    complete_task: tool({
      description:
        "Mark a task done and move it to Tasks/<list>/completed/. Completing a parent also completes and archives all child task files.",
      inputSchema: z.object({
        path: z.string().optional(),
        id: z.string().optional(),
      }),
      execute: async ({ path, id }) => {
        try {
          const p = await resolveTaskPath({ path, id });
          const tree = useVaultStore.getState().tree;
          const index = await loadTaskIndex(tree);
          const changedPaths = await completeTask(p, { tree, index });
          await useVaultStore.getState().refreshTree();
          return {
            ok: true as const,
            path: changedPaths[changedPaths.length - 1] ?? p,
            changedPaths,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    move_task_to_list: tool({
      description:
        "Move a task note into another Tasks/<list>/ folder (active list root).",
      inputSchema: z.object({
        path: z.string().optional(),
        id: z.string().optional(),
        list: z.string().min(1).describe("Target list name, e.g. Work"),
      }),
      execute: async ({ path, id, list }) => {
        try {
          const p = await resolveTaskPath({ path, id });
          const next = await moveTaskToList(p, list);
          await useVaultStore.getState().refreshTree();
          return {
            ok: true as const,
            path: next,
            changedPaths: next === p ? [p] : [p, next],
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    set_task_parent: tool({
      description:
        "Nest a task under a parent (parent UUID via parent_path) or promote to root (clear parent). Max two levels.",
      inputSchema: z.object({
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
      }),
      execute: async ({ path, id, parent_path, promote }) => {
        try {
          const child = await resolveTaskPath({ path, id });
          const tree = useVaultStore.getState().tree;
          const index = await loadTaskIndex(tree);
          if (promote || parent_path == null || parent_path === "") {
            await promoteTaskToRoot(child);
          } else {
            await nestTaskAsSubtask(parent_path, child, index);
          }
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: child, changedPaths: [child] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    add_task_comment: tool({
      description: "Append a ## Comments block (local timestamp) to a task note.",
      inputSchema: z.object({
        path: z.string().optional(),
        id: z.string().optional(),
        body: z.string().min(1),
      }),
      execute: async ({ path, id, body }) => {
        try {
          const p = await resolveTaskPath({ path, id });
          await addTaskComment(p, body);
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: p, changedPaths: [p] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    create_task_list: tool({
      description:
        "Create a new list folder under Tasks/ (not Inbox, not completed).",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
      execute: async ({ name }) => {
        try {
          const list = await createTaskList(name);
          await useVaultStore.getState().refreshTree();
          return {
            ok: true as const,
            list,
            path: `Tasks/${list}`,
            changedPaths: [`Tasks/${list}`],
          };
        } catch (e) {
          return fail(undefined, e);
        }
      },
    }),
  };
}

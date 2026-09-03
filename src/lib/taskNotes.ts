/** Task notes under vault-root `Tasks/` — parse, serialize, index, filters. */

import { slugifyTitle } from "../ai/clipArticle";
import {
  mergeFrontmatter,
  normalizeTags,
  splitFrontmatter,
  type FrontmatterData,
} from "./noteFrontmatter";
import {
  createNote,
  ensureFolder,
  isFolderNotePath,
  isTasksPath,
  joinPath,
  moveEntry,
  parentPath,
  readNote,
  TASKS_FOLDER,
  writeNote,
  type TreeNode,
} from "./vaultApi";

export const TASKS_ROOT = TASKS_FOLDER;
export const TASKS_INBOX = `${TASKS_FOLDER}/Inbox`;
/** Per-list archive folder name: `Tasks/<list>/completed/`. */
export const TASKS_COMPLETED_DIR = "completed";

export type TaskStatus = "open" | "done";
export type TaskPriority = 1 | 2 | 3 | 4;

export type TaskSubtask = {
  text: string;
  checked: boolean;
  /**
   * Always empty in the structured model — nesting is only task → subtask
   * (two levels). Deeper checklist indent is flattened on parse.
   */
  children: TaskSubtask[];
};

export type TaskComment = {
  /** Local `YYYY-MM-DD HH:mm`. */
  at: string;
  body: string;
};

export type TaskAttrs = {
  status: TaskStatus;
  due: string | null;
  priority: TaskPriority | null;
  labels: string[];
  /** Prefer `YYYY-MM-DD` when set. */
  created: string | null;
  /** Stable task UUID (empty only before migration / create). */
  id: string;
  /**
   * Parent task UUID, or null for roots.
   * Legacy vaults may still store a path here until `ensureTaskIdentities` runs.
   */
  parent: string | null;
};

export type TaskNote = {
  path: string;
  title: string;
  attrs: TaskAttrs;
  /** Optional freeform markdown between title and Subtasks/Comments. */
  description: string;
  subtasks: TaskSubtask[];
  comments: TaskComment[];
};

export type TaskIndexEntry = {
  path: string;
  /** Stable task UUID. */
  id: string;
  title: string;
  status: TaskStatus;
  due: string | null;
  priority: TaskPriority | null;
  labels: string[];
  created: string | null;
  /** Parent task UUID, or null for roots. */
  parent: string | null;
  /** Folder under Tasks/, e.g. `Inbox` or `Work`. Empty if file is directly in Tasks/. */
  list: string;
  /** Child task files pointing at this note (after index enrich). */
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  /** Legacy in-note checklist (not file children). */
  subtasks: TaskSubtask[];
  description: string;
};

export type TasksViewId = "inbox" | "today" | "all" | "filters";

export type TasksFilters = {
  query: string;
  list: string;
  priority: TaskPriority | "";
  label: string;
  status: TaskStatus | "open" | "all";
};

export function emptyTasksFilters(): TasksFilters {
  return {
    query: "",
    list: "",
    priority: "",
    label: "",
    status: "open",
  };
}

export function emptyTaskAttrs(): TaskAttrs {
  return {
    status: "open",
    due: null,
    priority: null,
    labels: [],
    created: null,
    id: "",
    parent: null,
  };
}

/** RFC-4122 UUID (any version / variant that crypto.randomUUID produces). */
const TASK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTaskUuid(value: string): boolean {
  return TASK_UUID_RE.test(value.trim());
}

export function newTaskId(): string {
  return crypto.randomUUID();
}

/** True when path is the Tasks folder or anything under it. */
export function isUnderTasksRoot(path: string): boolean {
  return isTasksPath(path.replace(/^\/+|\/+$/g, ""));
}

export function isTaskNotePath(path: string): boolean {
  const p = path.replace(/^\/+|\/+$/g, "");
  if (!p.toLowerCase().endsWith(".md")) return false;
  if (isFolderNotePath(p)) return false;
  if (!p.startsWith(`${TASKS_ROOT}/`)) return false;
  return true;
}

/** List folder name under Tasks (first segment after Tasks/), or empty. */
export function taskListFromPath(path: string): string {
  const p = path.replace(/^\/+|\/+$/g, "");
  if (!p.startsWith(`${TASKS_ROOT}/`)) return "";
  const rest = p.slice(TASKS_ROOT.length + 1);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  const list = parts[0]!;
  // Reserved: Tasks/completed/… is not a list.
  if (list === TASKS_COMPLETED_DIR) return "";
  return list;
}

/** True when the note lives under `Tasks/<list>/completed/`. */
export function isTaskInCompleted(path: string): boolean {
  const p = path.replace(/^\/+|\/+$/g, "");
  if (!p.startsWith(`${TASKS_ROOT}/`)) return false;
  const parts = p.slice(TASKS_ROOT.length + 1).split("/").filter(Boolean);
  // Tasks/<list>/completed/<file.md>
  return parts.length >= 3 && parts[1] === TASKS_COMPLETED_DIR;
}

/** Archive folder for a list: `Tasks/<list>/completed`. */
export function taskCompletedFolder(list: string): string {
  const l = (list || "Inbox").replace(/^\/+|\/+$/g, "") || "Inbox";
  return joinPath(joinPath(TASKS_ROOT, l), TASKS_COMPLETED_DIR);
}

export function localDateYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Short due label for task rows: Today / Tomorrow / localized date. */
export function formatTaskDueLabel(
  ymd: string | null | undefined,
  today: string = localDateYmd(),
): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (ymd === today) return "Today";
  const [ty, tm, td] = today.split("-").map(Number);
  const tomorrow = new Date(ty!, tm! - 1, td!);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (ymd === localDateYmd(tomorrow)) return "Tomorrow";
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function localDateTimeHm(d: Date = new Date()): string {
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${localDateYmd(d)} ${hm}`;
}

function parseDue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  // Accept ISO timestamps → local calendar day of the instant is ambiguous; take date prefix.
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

function parseCreated(value: unknown): string | null {
  return parseDue(value);
}

function parsePriority(value: unknown): TaskPriority | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.round(value);
    if (n >= 1 && n <= 4) return n as TaskPriority;
    return null;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    if (Number.isFinite(n)) {
      const r = Math.round(n);
      if (r >= 1 && r <= 4) return r as TaskPriority;
    }
  }
  return null;
}

function parseStatus(value: unknown): TaskStatus {
  if (typeof value === "string" && value.trim().toLowerCase() === "done") {
    return "done";
  }
  return "open";
}

function parseTaskId(value: unknown): string {
  if (typeof value !== "string") return "";
  const t = value.trim();
  return isTaskUuid(t) ? t : "";
}

/**
 * Parent ref: UUID (preferred) or legacy vault-relative task path.
 * Paths are rewritten to ids by `ensureTaskIdentities`.
 */
function parseParent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/^\/+|\/+$/g, "").trim();
  if (!t) return null;
  if (isTaskUuid(t)) return t;
  if (isTaskNotePath(t)) return t;
  return null;
}

export function getTaskAttrs(markdown: string): TaskAttrs {
  const { data } = splitFrontmatter(markdown);
  if (!data) return emptyTaskAttrs();
  return {
    status: parseStatus(data.status),
    due: parseDue(data.due),
    priority: parsePriority(data.priority),
    labels: normalizeTags(data.labels),
    created: parseCreated(data.created),
    id: parseTaskId(data.id),
    parent: parseParent(data.parent),
  };
}

/**
 * Patch task frontmatter keys. Preserves other keys.
 * Unparseable YAML fences are left unchanged.
 */
export function setTaskAttrs(
  markdown: string,
  patch: Partial<TaskAttrs>,
): string {
  const split = splitFrontmatter(markdown);
  if (split.hasFence && split.data === null) return markdown;

  const data: FrontmatterData = { ...(split.data ?? {}) };
  const next: TaskAttrs = {
    ...getTaskAttrs(markdown),
    ...patch,
  };

  data.status = next.status;
  if (next.due) data.due = next.due;
  else delete data.due;
  if (next.priority != null) data.priority = next.priority;
  else delete data.priority;
  if (next.labels.length > 0) data.labels = next.labels;
  else delete data.labels;
  if (next.created) data.created = next.created;
  else delete data.created;
  if (next.id) data.id = next.id;
  else delete data.id;
  if (next.parent) data.parent = next.parent;
  else delete data.parent;

  return mergeFrontmatter(data, split.body);
}

const SUBTASKS_HEADING = /^##\s+Subtasks\s*$/i;
const COMMENTS_HEADING = /^##\s+Comments\s*$/i;
const TITLE_HEADING = /^#\s+(.+?)\s*$/;
const COMMENT_AT = /^###\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/;
const TASK_LINE = /^([ \t]*)([*+-]|\d+\.)[ \t]+\[([ xX])\][ \t]+(.*)$/;

type BodyParts = {
  title: string;
  description: string;
  subtasks: TaskSubtask[];
  comments: TaskComment[];
};

function parseSubtaskLines(lines: string[]): TaskSubtask[] {
  type Frame = { item: TaskSubtask; indent: number };
  const roots: TaskSubtask[] = [];
  const stack: Frame[] = [];

  for (const line of lines) {
    const m = line.match(TASK_LINE);
    if (!m) continue;
    const indent = m[1]!.replace(/\t/g, "  ").length;
    const checked = m[3]!.toLowerCase() === "x";
    const text = m[4]!.trimEnd();
    const item: TaskSubtask = { text, checked, children: [] };

    while (stack.length > 0 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(item);
    } else {
      stack[stack.length - 1]!.item.children.push(item);
    }
    stack.push({ item, indent });
  }
  return roots;
}

/**
 * Collapse checklist nesting to a flat list (task → subtask only).
 * Deeper indented items become siblings.
 */
export function flattenSubtasksOneLevel(items: TaskSubtask[]): TaskSubtask[] {
  const out: TaskSubtask[] = [];
  const walk = (list: TaskSubtask[]) => {
    for (const it of list) {
      out.push({ text: it.text, checked: it.checked, children: [] });
      if (it.children.length > 0) walk(it.children);
    }
  };
  walk(items);
  return out;
}

function serializeSubtasks(items: TaskSubtask[], indent = 0): string[] {
  const pad = "  ".repeat(indent);
  const out: string[] = [];
  for (const item of items) {
    const mark = item.checked ? "x" : " ";
    out.push(`${pad}- [${mark}] ${item.text}`);
    if (item.children.length > 0) {
      out.push(...serializeSubtasks(item.children, indent + 1));
    }
  }
  return out;
}

function parseBody(body: string): BodyParts {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let title = "";
  let i = 0;

  // Skip leading blanks
  while (i < lines.length && lines[i]!.trim() === "") i += 1;
  if (i < lines.length) {
    const tm = lines[i]!.match(TITLE_HEADING);
    if (tm) {
      title = tm[1]!.trim();
      i += 1;
    }
  }

  const descLines: string[] = [];
  const subtaskLines: string[] = [];
  const commentLines: string[] = [];
  let mode: "desc" | "subtasks" | "comments" = "desc";

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (SUBTASKS_HEADING.test(line)) {
      mode = "subtasks";
      continue;
    }
    if (COMMENTS_HEADING.test(line)) {
      mode = "comments";
      continue;
    }
    if (mode === "desc") descLines.push(line);
    else if (mode === "subtasks") subtaskLines.push(line);
    else commentLines.push(line);
  }

  // Trim trailing blanks from description
  while (descLines.length > 0 && descLines[descLines.length - 1]!.trim() === "") {
    descLines.pop();
  }
  while (descLines.length > 0 && descLines[0]!.trim() === "") {
    descLines.shift();
  }

  const comments: TaskComment[] = [];
  let curAt: string | null = null;
  let curBody: string[] = [];
  const flush = () => {
    if (!curAt) return;
    comments.push({
      at: curAt,
      body: curBody.join("\n").replace(/^\n+/, "").replace(/\n+$/, ""),
    });
    curAt = null;
    curBody = [];
  };
  for (const line of commentLines) {
    const cm = line.match(COMMENT_AT);
    if (cm) {
      flush();
      curAt = cm[1]!;
      continue;
    }
    if (curAt) curBody.push(line);
  }
  flush();

  return {
    title,
    description: descLines.join("\n"),
    subtasks: flattenSubtasksOneLevel(parseSubtaskLines(subtaskLines)),
    comments,
  };
}

function displayTitle(path: string, parsedTitle: string): string {
  if (parsedTitle.trim()) return parsedTitle.trim();
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "") || "Untitled";
}

/** Parse a full task note (path + markdown). */
export function parseTaskNote(path: string, markdown: string): TaskNote {
  const attrs = getTaskAttrs(markdown);
  const { body } = splitFrontmatter(markdown);
  const parts = parseBody(body);
  return {
    path,
    title: displayTitle(path, parts.title),
    attrs,
    description: parts.description,
    subtasks: parts.subtasks,
    comments: parts.comments,
  };
}

function extractTitleFromBody(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (line.trim() === "") continue;
    const tm = line.match(TITLE_HEADING);
    if (tm) return tm[1]!.trim();
    break;
  }
  return "";
}

function countCommentsInBody(body: string): number {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let inComments = false;
  let count = 0;
  for (const line of lines) {
    if (COMMENTS_HEADING.test(line)) {
      inComments = true;
      continue;
    }
    if (inComments && COMMENT_AT.test(line)) {
      count += 1;
    }
  }
  return count;
}

/** Lightweight parse for list index — frontmatter, title, comment count only. */
export function parseTaskIndexLight(
  path: string,
  markdown: string,
): TaskIndexEntry {
  const attrs = getTaskAttrs(markdown);
  const { body } = splitFrontmatter(markdown);
  const parsedTitle = extractTitleFromBody(body);
  return {
    path,
    id: attrs.id,
    title: displayTitle(path, parsedTitle),
    status: attrs.status,
    due: attrs.due,
    priority: attrs.priority,
    labels: attrs.labels,
    created: attrs.created,
    parent: attrs.parent,
    list: taskListFromPath(path),
    subtaskTotal: 0,
    subtaskDone: 0,
    commentCount: countCommentsInBody(body),
    subtasks: [],
    description: "",
  };
}

/** Serialize structured task fields to markdown (stable section order). */
export function serializeTaskNote(note: Omit<TaskNote, "path"> & { path?: string }): string {
  const data: FrontmatterData = {};
  if (note.attrs.id) data.id = note.attrs.id;
  data.status = note.attrs.status;
  if (note.attrs.due) data.due = note.attrs.due;
  if (note.attrs.priority != null) data.priority = note.attrs.priority;
  if (note.attrs.labels.length > 0) data.labels = note.attrs.labels;
  if (note.attrs.created) data.created = note.attrs.created;
  if (note.attrs.parent) data.parent = note.attrs.parent;

  const chunks: string[] = [`# ${note.title.trim() || "Untitled"}`];
  if (note.description.trim()) {
    chunks.push("", note.description.trim());
  }
  if (note.subtasks.length > 0) {
    chunks.push("", "## Subtasks", "", ...serializeSubtasks(note.subtasks));
  }
  if (note.comments.length > 0) {
    chunks.push("", "## Comments", "");
    for (let i = 0; i < note.comments.length; i++) {
      const c = note.comments[i]!;
      if (i > 0) chunks.push("");
      chunks.push(`### ${c.at}`, "", c.body.trim() || "");
    }
  }
  const body = `${chunks.join("\n").replace(/\n+$/, "")}\n`;
  return mergeFrontmatter(data, body);
}

export function taskIndexEntryFromNote(note: TaskNote): TaskIndexEntry {
  return {
    path: note.path,
    id: note.attrs.id,
    title: note.title,
    status: note.attrs.status,
    due: note.attrs.due,
    priority: note.attrs.priority,
    labels: note.attrs.labels,
    created: note.attrs.created,
    parent: note.attrs.parent,
    list: taskListFromPath(note.path),
    // Filled by enrichTaskIndexChildren after the full index load.
    subtaskTotal: 0,
    subtaskDone: 0,
    commentCount: note.comments.length,
    subtasks: note.subtasks,
    description: note.description,
  };
}

/**
 * Resolve legacy path parents → ids, then attach child-file counts keyed by id.
 */
export function enrichTaskIndexChildren(
  entries: readonly TaskIndexEntry[],
): TaskIndexEntry[] {
  const byId = new Map<string, TaskIndexEntry>();
  const byPath = new Map<string, TaskIndexEntry>();
  for (const e of entries) {
    if (e.id) byId.set(e.id, e);
    byPath.set(e.path, e);
  }

  const resolved = entries.map((e) => {
    let parent = e.parent;
    if (parent && !byId.has(parent) && byPath.has(parent)) {
      parent = byPath.get(parent)!.id || null;
    } else if (parent && !isTaskUuid(parent)) {
      parent = null;
    } else if (parent && !byId.has(parent)) {
      parent = null;
    }
    return parent === e.parent ? e : { ...e, parent };
  });

  const kidsByParent = new Map<string, TaskIndexEntry[]>();
  for (const e of resolved) {
    if (!e.parent) continue;
    const list = kidsByParent.get(e.parent) ?? [];
    list.push(e);
    kidsByParent.set(e.parent, list);
  }
  return resolved.map((e) => {
    const kids = e.id ? (kidsByParent.get(e.id) ?? []) : [];
    return {
      ...e,
      subtaskTotal: kids.length,
      subtaskDone: kids.filter((k) => k.status === "done").length,
    };
  });
}

export function collectTaskNotePaths(
  tree: TreeNode | null | undefined,
): string[] {
  const root = findNode(tree, TASKS_ROOT);
  if (!root?.isDir) return [];
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.isDir) {
        // Skip per-list archives — active index stays O(open tasks).
        if (child.name === TASKS_COMPLETED_DIR) continue;
        walk(child);
        continue;
      }
      if (isTaskNotePath(child.path) && !isTaskInCompleted(child.path)) {
        out.push(child.path);
      }
    }
  };
  walk(root);
  // Preserve vault tree / order.json order (required for drag-reorder).
  return out;
}

function findNode(
  tree: TreeNode | null | undefined,
  path: string,
): TreeNode | null {
  if (!tree) return null;
  if (!path) return tree;
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

const READ_CONCURRENCY = 8;

async function readTaskIndexEntries(
  paths: readonly string[],
): Promise<TaskIndexEntry[]> {
  const entries: TaskIndexEntry[] = [];
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const chunk = paths.slice(i, i + READ_CONCURRENCY);
    const loaded = await Promise.all(
      chunk.map(async (path) => {
        try {
          const md = await readNote(path);
          return parseTaskIndexLight(path, md);
        } catch {
          return null;
        }
      }),
    );
    for (const e of loaded) {
      if (e) entries.push(e);
    }
  }
  return entries;
}

/** Reload specific paths and merge into an existing index (preserves order). */
export async function refreshTaskIndexEntries(
  entries: readonly TaskIndexEntry[],
  paths: readonly string[],
): Promise<TaskIndexEntry[]> {
  if (paths.length === 0) return [...entries];
  const loaded = await readTaskIndexEntries(paths);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  for (const e of loaded) byPath.set(e.path, e);
  const order = entries.map((e) => e.path);
  for (const p of paths) {
    if (!order.includes(p) && byPath.has(p)) order.push(p);
  }
  const merged = order
    .map((p) => byPath.get(p))
    .filter((e): e is TaskIndexEntry => e != null);
  return enrichTaskIndexChildren(merged);
}

export async function loadTaskIndex(
  tree: TreeNode | null | undefined,
  prev?: readonly TaskIndexEntry[],
): Promise<TaskIndexEntry[]> {
  const paths = collectTaskNotePaths(tree);
  if (paths.length === 0) return [];

  if (prev && prev.length > 0) {
    const prevByPath = new Map(prev.map((e) => [e.path, e]));
    const samePaths =
      paths.length === prev.length && paths.every((p) => prevByPath.has(p));
    if (samePaths) {
      // Same files, but tree order and/or frontmatter (e.g. parent) may have changed.
      const fresh = await readTaskIndexEntries(paths);
      const byPath = new Map(fresh.map((e) => [e.path, e]));
      const reordered = paths
        .map((p) => byPath.get(p))
        .filter((e): e is TaskIndexEntry => e != null);
      return enrichTaskIndexChildren(reordered);
    }

    const pathSet = new Set(paths);
    const newPaths = paths.filter((p) => !prevByPath.has(p));
    const kept = prev.filter((e) => pathSet.has(e.path));
    if (newPaths.length > 0 && kept.length + newPaths.length === paths.length) {
      const loaded = await readTaskIndexEntries(newPaths);
      const byPath = new Map([
        ...kept.map((e) => [e.path, e] as const),
        ...loaded.map((e) => [e.path, e] as const),
      ]);
      const merged = paths
        .map((p) => byPath.get(p))
        .filter((e): e is TaskIndexEntry => e != null);
      return enrichTaskIndexChildren(merged);
    }
  }

  return enrichTaskIndexChildren(await readTaskIndexEntries(paths));
}

/** List folder names directly under Tasks/ (for filter dropdown). */
export function collectTaskLists(tree: TreeNode | null | undefined): string[] {
  const root = findNode(tree, TASKS_ROOT);
  if (!root?.isDir) return [];
  return (root.children ?? [])
    .filter((c) => c.isDir && c.name !== TASKS_COMPLETED_DIR)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function collectTaskLabels(entries: readonly TaskIndexEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    for (const g of e.labels) {
      const t = g.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function compareTasks(a: TaskIndexEntry, b: TaskIndexEntry): number {
  // Priority: lower number first; nulls last
  const pa = a.priority ?? 99;
  const pb = b.priority ?? 99;
  if (pa !== pb) return pa - pb;
  // Due: earlier first; nulls last
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

export function filterTaskIndex(
  entries: readonly TaskIndexEntry[],
  view: TasksViewId,
  filters: TasksFilters,
  today: string = localDateYmd(),
): TaskIndexEntry[] {
  const q = filters.query.trim().toLowerCase();
  const label = filters.label.trim().toLowerCase();
  const list = filters.list.trim();

  let list_ = entries.filter((e) => {
    if (view === "inbox") {
      if (e.list !== "Inbox") return false;
    } else if (view === "today") {
      if (e.status === "done") return false;
      if (e.due !== today) return false;
    }

    if (view === "filters" || view === "all") {
      if (filters.status === "open" && e.status !== "open") return false;
      if (filters.status === "done" && e.status !== "done") return false;
    } else if (e.status === "done" && view !== "inbox") {
      // inbox can show done? Plan: inbox shows all in Inbox folder; hide done by default via filters.status
    }

    if (view === "inbox" && filters.status === "open" && e.status !== "open") {
      return false;
    }
    if (view === "inbox" && filters.status === "done" && e.status !== "done") {
      return false;
    }

    // Named-list filter only for All / Filters. Smart views ignore a sticky
    // `filters.list` left over from opening a project list in the sidebar.
    if ((view === "all" || view === "filters") && list && e.list !== list) {
      return false;
    }
    // Priority / label / query only on Filters — otherwise a sticky Filters
    // selection empties Inbox / Today / lists.
    if (view === "filters") {
      if (filters.priority !== "" && e.priority !== filters.priority) {
        return false;
      }
      if (label && !e.labels.some((g) => g.toLowerCase() === label)) {
        return false;
      }
      if (q) {
        const hay = [e.title, e.list, ...e.labels, e.due ?? ""]
          .join("\n")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
    }
    return true;
  });

  // Today: smart sort. Inbox / lists / All / Filters: keep vault
  // tree order so drag-reorder (order.json) is visible.
  if (view === "today") {
    list_ = [...list_].sort(compareTasks);
  }
  return list_;
}

export function taskFileNameFromTitle(title: string): string {
  return `${slugifyTitle(title) || "task"}.md`;
}

export async function ensureTasksLayout(): Promise<void> {
  await ensureFolder(TASKS_ROOT);
  await ensureFolder(TASKS_INBOX);
}

/**
 * Create a new list folder under Tasks/ (e.g. `Work`).
 * Returns the list name used on disk.
 */
export async function createTaskList(name: string): Promise<string> {
  const cleaned = name
    .trim()
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, " ");
  if (!cleaned) throw new Error("List name is required");
  if (/^inbox$/i.test(cleaned)) {
    throw new Error("Inbox is a reserved list");
  }
  if (cleaned.toLowerCase() === TASKS_COMPLETED_DIR) {
    throw new Error("completed is a reserved folder name");
  }
  await ensureTasksLayout();
  const folder = joinPath(TASKS_ROOT, cleaned);
  await ensureFolder(folder);
  return cleaned;
}

/**
 * Create a new task note under `listFolder` (relative under Tasks, e.g. `Inbox` or `Work`).
 * Returns the vault-relative path. `parent` is the parent task UUID (not a path).
 */
export async function createTaskNote(opts: {
  title: string;
  list?: string;
  due?: string | null;
  priority?: TaskPriority | null;
  labels?: string[];
  /** Parent task UUID. */
  parent?: string | null;
  id?: string;
  description?: string;
  /** Comment bodies (timestamps default to now). */
  comments?: Array<string | { at?: string; body: string }>;
}): Promise<string> {
  await ensureTasksLayout();
  const list = (opts.list ?? "Inbox").replace(/^\/+|\/+$/g, "") || "Inbox";
  const folder = joinPath(TASKS_ROOT, list);
  await ensureFolder(folder);
  const baseName = taskFileNameFromTitle(opts.title);
  let path = joinPath(folder, baseName);
  // Avoid clobber: createNote fails if exists — try suffixes
  for (let n = 0; n < 50; n++) {
    const candidate =
      n === 0
        ? path
        : joinPath(folder, `${slugifyTitle(opts.title) || "task"}-${n + 1}.md`);
    try {
      await readNote(candidate);
      continue;
    } catch {
      path = candidate;
      break;
    }
  }
  await createNote(path);
  const id = opts.id && isTaskUuid(opts.id) ? opts.id : newTaskId();
  const parent =
    opts.parent && isTaskUuid(opts.parent) ? opts.parent : null;
  const nowHm = localDateTimeHm();
  const comments = (opts.comments ?? [])
    .map((c) => {
      if (typeof c === "string") {
        const body = c.trim();
        return body ? { at: nowHm, body } : null;
      }
      const body = (c.body ?? "").trim();
      if (!body) return null;
      return { at: (c.at ?? "").trim() || nowHm, body };
    })
    .filter((c): c is { at: string; body: string } => c != null);
  const note: TaskNote = {
    path,
    title: opts.title.trim() || "Untitled",
    attrs: {
      status: "open",
      due: opts.due ?? null,
      priority: opts.priority ?? null,
      labels: opts.labels ?? [],
      created: localDateYmd(),
      id,
      parent,
    },
    description: (opts.description ?? "").trim(),
    subtasks: [],
    comments,
  };
  await writeNote(path, serializeTaskNote(note));
  return path;
}

export async function loadTaskNote(path: string): Promise<TaskNote> {
  const md = await readNote(path);
  return parseTaskNote(path, md);
}

export async function saveTaskNote(note: TaskNote): Promise<void> {
  await writeNote(note.path, serializeTaskNote(note));
}

/**
 * Move a single task note into another list folder (no child cascade).
 * Returns the new path (unchanged when already in that list's active folder).
 * Tasks in `completed/` move to the target list root (not into its archive).
 */
async function moveTaskFileToList(
  path: string,
  targetList: string,
): Promise<string> {
  const p = path.replace(/^\/+|\/+$/g, "");
  const current = taskListFromPath(p) || "Inbox";
  const inCompleted = isTaskInCompleted(p);
  if (current === targetList && !inCompleted) return p;
  const folder = joinPath(TASKS_ROOT, targetList);
  await ensureFolder(folder);
  // Large index = append (see vault::move_entry).
  return moveEntry(p, folder, 1_000_000);
}

/**
 * Move a task note into another list folder under Tasks/ (e.g. Inbox → Work).
 * When the task has file children (`parent` = its id), those are moved too
 * (same cascade as complete). Returns the parent's new path.
 */
export async function moveTaskToList(
  path: string,
  list: string,
  opts?: {
    tree?: TreeNode | null;
    index?: readonly TaskIndexEntry[];
  },
): Promise<string> {
  const targetList =
    (list ?? "Inbox").replace(/^\/+|\/+$/g, "") || "Inbox";
  const p = path.replace(/^\/+|\/+$/g, "");

  let index = opts?.index ? [...opts.index] : null;
  if (!index && opts?.tree != null) {
    index = await loadTaskIndex(opts.tree);
  }

  let parentId: string | null = null;
  if (index) {
    const fromIndex = index.find((e) => e.path === p);
    parentId = fromIndex?.id ?? null;
  }
  if (!parentId) {
    try {
      const note = await loadTaskNote(p);
      parentId = note.attrs.id;
    } catch {
      parentId = null;
    }
  }

  if (parentId && index) {
    const kids = index.filter(
      (e) =>
        e.parent === parentId &&
        e.path !== p &&
        !isTaskInCompleted(e.path),
    );
    for (const kid of kids) {
      await moveTaskFileToList(kid.path, targetList);
    }
  }

  return moveTaskFileToList(p, targetList);
}

/** Toggle done/open and persist (file stays in place). Prefer `completeTask` to archive. */
export async function setTaskStatus(
  path: string,
  status: TaskStatus,
): Promise<TaskNote> {
  const md = await readNote(path);
  const next = setTaskAttrs(md, { status });
  await writeNote(path, next);
  return parseTaskNote(path, next);
}

/**
 * Mark one task done and move it into `Tasks/<list>/completed/`.
 * Idempotent if already archived. Does not reopen / uncomplete.
 */
async function completeTaskFile(path: string): Promise<string> {
  const p = path.replace(/^\/+|\/+$/g, "");
  const md = await readNote(p);
  const withDone = setTaskAttrs(md, { status: "done" });
  await writeNote(p, withDone);
  if (isTaskInCompleted(p)) return p;
  const list = taskListFromPath(p) || "Inbox";
  const folder = taskCompletedFolder(list);
  await ensureFolder(folder);
  return moveEntry(p, folder, 1_000_000);
}

/**
 * Mark a task done and archive it under `Tasks/<list>/completed/`.
 * When the task has file children (`parent` = its id), those are completed first.
 * Returns all final paths (children then parent).
 */
export async function completeTask(
  path: string,
  opts?: {
    tree?: TreeNode | null;
    index?: readonly TaskIndexEntry[];
  },
): Promise<string[]> {
  const p = path.replace(/^\/+|\/+$/g, "");
  const note = await loadTaskNote(p);
  const changed: string[] = [];

  let index = opts?.index ? [...opts.index] : null;
  if (!index && opts?.tree != null) {
    index = await loadTaskIndex(opts.tree);
  }

  if (note.attrs.id && index) {
    const kids = index.filter(
      (e) =>
        e.parent === note.attrs.id &&
        e.path !== p &&
        !isTaskInCompleted(e.path),
    );
    for (const kid of kids) {
      changed.push(await completeTaskFile(kid.path));
    }
  }

  changed.push(await completeTaskFile(p));
  return changed;
}

/** Append a comment block under `## Comments`. */
export async function addTaskComment(
  path: string,
  body: string,
  at: string = localDateTimeHm(),
): Promise<TaskNote> {
  const text = body.trim();
  if (!text) throw new Error("Comment body is empty");
  const note = await loadTaskNote(path);
  const next: TaskNote = {
    ...note,
    comments: [...note.comments, { at, body: text }],
  };
  await saveTaskNote(next);
  return next;
}

export function parentFolderOfTask(path: string): string {
  return parentPath(path);
}

/** Sibling task-note paths under a folder, in tree/order.json order. */
export function listTaskSiblingsInFolder(
  tree: TreeNode | null | undefined,
  folder: string,
): string[] {
  const cleaned = folder.replace(/^\/+|\/+$/g, "");
  const node = findNode(tree, cleaned);
  if (!node?.isDir) return [];
  const out: string[] = [];
  for (const child of node.children ?? []) {
    if (child.isDir) continue;
    if (isTaskNotePath(child.path)) out.push(child.path);
  }
  return out;
}

/**
 * Set or clear the parent link on a task note (file kept).
 * `parentId` is the parent task UUID (null = root).
 * When nesting, any notes that currently parent to the child are re-parented
 * onto `parentId` (max two levels).
 */
export async function setTaskParent(
  childPath: string,
  parentId: string | null,
  index?: readonly TaskIndexEntry[],
): Promise<void> {
  const child = await loadTaskNote(childPath);
  let childId = child.attrs.id;
  if (!childId) {
    childId = newTaskId();
    await writeNote(
      childPath,
      setTaskAttrs(await readNote(childPath), { id: childId, parent: parentId }),
    );
  } else {
    if (parentId && parentId === childId) return;
    await writeNote(
      childPath,
      setTaskAttrs(await readNote(childPath), { parent: parentId }),
    );
  }

  if (!parentId || !index) return;
  for (const e of index) {
    if (e.parent === childId) {
      const childMd = await readNote(e.path);
      await writeNote(e.path, setTaskAttrs(childMd, { parent: parentId }));
    }
  }
}

/**
 * Nest `childPath` under `parentPath` via frontmatter `parent` id (files stay).
 */
export async function nestTaskAsSubtask(
  parentPath: string,
  childPath: string,
  index?: readonly TaskIndexEntry[],
): Promise<void> {
  if (parentPath === childPath) return;
  const parentNote = await loadTaskNote(parentPath);
  let parentId = parentNote.attrs.id;
  if (!parentId) {
    parentId = newTaskId();
    await saveTaskNote({
      ...parentNote,
      attrs: { ...parentNote.attrs, id: parentId },
    });
  }
  // Parent is itself a child — attach to grandparent id (two-level cap).
  if (parentNote.attrs.parent && isTaskUuid(parentNote.attrs.parent)) {
    await setTaskParent(childPath, parentNote.attrs.parent, index);
    return;
  }
  await setTaskParent(childPath, parentId, index);
}

/**
 * Clear `parent` so the task becomes a root in its list folder.
 */
export async function promoteTaskToRoot(path: string): Promise<void> {
  await setTaskParent(path, null);
}

/**
 * Ensure every task note has a stable `id`, and rewrite legacy path `parent`
 * values to parent UUIDs. Returns how many files were written.
 */
export async function ensureTaskIdentities(
  tree: TreeNode | null | undefined,
): Promise<number> {
  const paths = collectTaskNotePaths(tree);
  const notes: TaskNote[] = [];
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const chunk = paths.slice(i, i + READ_CONCURRENCY);
    const loaded = await Promise.all(
      chunk.map(async (path) => {
        try {
          return parseTaskNote(path, await readNote(path));
        } catch {
          return null;
        }
      }),
    );
    for (const n of loaded) {
      if (n) notes.push(n);
    }
  }

  const byPath = new Map(notes.map((n) => [n.path, n]));
  const dirty = new Set<string>();

  for (const n of notes) {
    if (!n.attrs.id) {
      n.attrs.id = newTaskId();
      dirty.add(n.path);
    }
  }

  const byId = new Map(notes.map((n) => [n.attrs.id, n]));

  for (const n of notes) {
    const p = n.attrs.parent;
    if (!p) continue;
    if (isTaskUuid(p) && byId.has(p)) continue;
    if (isTaskNotePath(p) && byPath.has(p)) {
      const parentNote = byPath.get(p)!;
      n.attrs.parent = parentNote.attrs.id || null;
      dirty.add(n.path);
      continue;
    }
    // Dangling / unknown parent ref
    n.attrs.parent = null;
    dirty.add(n.path);
  }

  for (const path of dirty) {
    const note = byPath.get(path);
    if (!note) continue;
    await writeNote(path, serializeTaskNote(note));
  }
  return dirty.size;
}

/**
 * Place `fromPath` before/after `targetPath` in the target's list folder.
 * `toIndex` for move_entry is among all folder children (after removing the moved name).
 */
export async function reorderTaskRelativeTo(
  fromPath: string,
  targetPath: string,
  place: "before" | "after",
  tree: TreeNode | null | undefined,
): Promise<void> {
  if (fromPath === targetPath) return;
  const toFolder = parentFolderOfTask(targetPath);
  const folderNode = findNode(tree, toFolder);
  const siblings = (folderNode?.children ?? []).map((c) => c.name);
  const fromName = fromPath.includes("/")
    ? fromPath.slice(fromPath.lastIndexOf("/") + 1)
    : fromPath;
  const targetName = targetPath.includes("/")
    ? targetPath.slice(targetPath.lastIndexOf("/") + 1)
    : targetPath;
  const without = siblings.filter((n) => n !== fromName);
  let ti = without.indexOf(targetName);
  if (ti < 0) {
    // Target not in tree snapshot — append
    await moveEntry(fromPath, toFolder, without.length);
    return;
  }
  if (place === "after") ti += 1;
  await moveEntry(fromPath, toFolder, ti);
}

/** @deprecated Prefer reorderTaskRelativeTo */
export async function reorderTaskInFolder(
  path: string,
  folder: string,
  toIndex: number,
  _tree: TreeNode | null | undefined,
): Promise<void> {
  await moveEntry(path, folder, Math.max(0, toIndex));
}

/** Reorder subtasks inside a parent note. */
export async function reorderSubtasksInNote(
  path: string,
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const note = await loadTaskNote(path);
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= note.subtasks.length ||
    toIndex >= note.subtasks.length ||
    fromIndex === toIndex
  ) {
    return;
  }
  const next = [...note.subtasks];
  const [item] = next.splice(fromIndex, 1);
  if (!item) return;
  next.splice(toIndex, 0, item);
  await saveTaskNote({ ...note, subtasks: next });
}

/**
 * @deprecated Checklist promote — prefer promoteTaskToRoot for file children.
 * Promote a top-level checklist subtask to its own task note.
 */
export async function promoteSubtaskToTask(
  parentPath: string,
  subIndex: number,
  opts?: {
    relativeTo?: { path: string; place: "before" | "after" };
    tree?: TreeNode | null;
  },
): Promise<string | null> {
  const note = await loadTaskNote(parentPath);
  const item = note.subtasks[subIndex];
  if (!item) return null;
  const list = opts?.relativeTo
    ? taskListFromPath(opts.relativeTo.path) || "Inbox"
    : taskListFromPath(parentPath) || "Inbox";
  const created = await createTaskNote({
    title: item.text,
    list,
  });
  if (item.checked) {
    await completeTask(created);
  }
  const nextSubs = note.subtasks.filter((_, i) => i !== subIndex);
  await saveTaskNote({ ...note, subtasks: nextSubs });
  if (opts?.relativeTo) {
    await reorderTaskRelativeTo(
      created,
      opts.relativeTo.path,
      opts.relativeTo.place,
      opts.tree,
    );
  }
  return created;
}

/** Move a top-level subtask from one parent note to another. */
export async function moveSubtaskBetweenParents(
  fromParent: string,
  subIndex: number,
  toParent: string,
): Promise<void> {
  if (fromParent === toParent) return;
  const item = await removeSubtaskAt(fromParent, subIndex);
  if (!item) return;
  await insertSubtaskAt(toParent, item, Number.MAX_SAFE_INTEGER);
}

/** Insert a subtask at index under parent (for cross-parent moves later). */
export async function insertSubtaskAt(
  parentPath: string,
  item: TaskSubtask,
  atIndex: number,
): Promise<void> {
  const note = await loadTaskNote(parentPath);
  const next = [...note.subtasks];
  const i = Math.max(0, Math.min(atIndex, next.length));
  next.splice(i, 0, item);
  await saveTaskNote({ ...note, subtasks: next });
}

export async function removeSubtaskAt(
  parentPath: string,
  subIndex: number,
): Promise<TaskSubtask | null> {
  const note = await loadTaskNote(parentPath);
  const item = note.subtasks[subIndex];
  if (!item) return null;
  await saveTaskNote({
    ...note,
    subtasks: note.subtasks.filter((_, i) => i !== subIndex),
  });
  return item;
}

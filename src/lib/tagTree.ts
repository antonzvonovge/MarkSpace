import { noteLabel } from "./tagGraph";
import {
  isDashboardsPath,
  isTasksPath,
  type NoteTags,
  type TreeNode,
} from "./vaultApi";

/** Empty selection id: notes with no tags. A real tag path is never empty. */
export const UNTAGGED_SELECTION = "";

export type TagTreeNode = {
  /** Full tag path (`language/georgian`). */
  path: string;
  /** Last segment. */
  name: string;
  children: TagTreeNode[];
};

export type TagFlatRow =
  | { kind: "untagged"; key: "untagged" }
  | {
      kind: "tag";
      key: string;
      path: string;
      name: string;
      depth: number;
      hasChildren: boolean;
      open: boolean;
    }
  | { kind: "divider"; key: "divider" }
  | { kind: "listHeader"; key: "list-header" }
  | { kind: "note"; key: string; path: string }
  | { kind: "empty"; key: "empty" };

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/** True when `tag` is `branch` or a descendant (`branch/…`). */
export function tagHasPrefix(tag: string, branch: string): boolean {
  const t = tagKey(tag);
  const b = tagKey(branch);
  if (!t || !b) return false;
  return t === b || t.startsWith(`${b}/`);
}

/**
 * Parent click includes descendants. Exact mode keeps only the tag itself.
 * `#language/georgian` is not the tag `language`.
 */
export function tagInBranch(
  tag: string,
  branch: string,
  exactOnly: boolean,
): boolean {
  const t = tagKey(tag);
  const b = tagKey(branch);
  if (!t || !b) return false;
  if (t === b) return true;
  if (exactOnly) return false;
  return t.startsWith(`${b}/`);
}

/** Replace a tag or its `from/…` suffix. Unrelated tags are returned unchanged. */
export function remapTagPrefix(tag: string, from: string, to: string): string {
  const t = tagKey(tag);
  const f = tagKey(from);
  if (!t || !f) return tag;
  if (t === f) return to;
  if (t.startsWith(`${f}/`)) return `${to}${tag.slice(from.length)}`;
  return tag;
}

/** Drop a branch (`to === null`) or rename its prefix. Dedupes case-insensitively. */
export function applyTagPrefix(
  tags: string[],
  from: string,
  to: string | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const name = tag.trim();
    if (!name) continue;
    let next = name;
    if (tagHasPrefix(name, from)) {
      if (to == null) continue;
      next = remapTagPrefix(name, from, to).trim();
      if (!next) continue;
    }
    const key = tagKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
  }
  return out;
}

export function applyTagPrefixToNotes(
  notes: NoteTags[],
  from: string,
  to: string | null,
): NoteTags[] {
  const out: NoteTags[] = [];
  for (const entry of notes) {
    const tags = applyTagPrefix(entry.tags, from, to);
    if (tags.length === 0) continue;
    out.push({ path: entry.path, tags });
  }
  return out;
}

export function addTagToNotes(
  notes: NoteTags[],
  path: string,
  tag: string,
): NoteTags[] {
  const name = tag.trim();
  if (!path || !name) return notes;
  const existing = notes.find((entry) => entry.path === path);
  if (!existing) return [...notes, { path, tags: [name] }];
  if (existing.tags.some((item) => tagKey(item) === tagKey(name))) return notes;
  return notes.map((entry) =>
    entry.path === path ? { ...entry, tags: [...entry.tags, name] } : entry,
  );
}

type MutableNode = {
  path: string;
  name: string;
  children: Map<string, MutableNode>;
};

function insertTag(root: Map<string, MutableNode>, tag: string): void {
  const parts = tag
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return;
  let level = root;
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    const key = tagKey(acc);
    let node = level.get(key);
    if (!node) {
      node = { path: acc, name: part, children: new Map() };
      level.set(key, node);
    }
    level = node.children;
  }
}

function freeze(nodes: Map<string, MutableNode>): TagTreeNode[] {
  const out: TagTreeNode[] = [];
  for (const node of nodes.values()) {
    out.push({
      path: node.path,
      name: node.name,
      children: freeze(node.children),
    });
  }
  out.sort((a, b) => compareNames(a.name, b.name));
  return out;
}

/** Hierarchy from tag strings. Missing parents are synthesized. First spelling wins. */
export function buildTagTree(tags: Iterable<string>): TagTreeNode[] {
  const root = new Map<string, MutableNode>();
  for (const tag of tags) insertTag(root, tag);
  return freeze(root);
}

export function collectTagDocumentPaths(
  node: TreeNode | null,
  out: string[] = [],
): string[] {
  if (!node) return out;
  if (isTasksPath(node.path) || isDashboardsPath(node.path)) return out;
  if (!node.isDir) {
    const lower = node.path.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".pdf")) out.push(node.path);
  }
  for (const child of node.children ?? []) collectTagDocumentPaths(child, out);
  return out;
}

function taggedPathSet(notes: NoteTags[]): Set<string> {
  const tagged = new Set<string>();
  for (const entry of notes) {
    if (entry.tags.some((tag) => tag.trim())) tagged.add(entry.path);
  }
  return tagged;
}

export function documentsForSelection(
  notes: NoteTags[],
  documentPaths: string[],
  selection: string | null,
  hideSubtagNotes: boolean,
): string[] {
  if (selection == null) return [];
  if (selection === UNTAGGED_SELECTION) {
    const tagged = taggedPathSet(notes);
    return documentPaths
      .filter((path) => !tagged.has(path))
      .sort((a, b) => compareNames(noteLabel(a), noteLabel(b)));
  }
  const paths: string[] = [];
  for (const entry of notes) {
    if (entry.tags.some((tag) => tagInBranch(tag, selection, hideSubtagNotes))) {
      paths.push(entry.path);
    }
  }
  paths.sort((a, b) => compareNames(noteLabel(a), noteLabel(b)));
  return paths;
}

function flattenNodes(
  nodes: TagTreeNode[],
  expanded: ReadonlySet<string>,
  depth: number,
  out: TagFlatRow[],
): void {
  for (const node of nodes) {
    const open = expanded.has(node.path.toLowerCase());
    const hasChildren = node.children.length > 0;
    out.push({
      kind: "tag",
      key: `tag:${node.path.toLowerCase()}`,
      path: node.path,
      name: node.name,
      depth,
      hasChildren,
      open,
    });
    if (open && hasChildren) flattenNodes(node.children, expanded, depth + 1, out);
  }
}

/**
 * Untagged plus the tag tree. The note list is included when `includeDocuments`
 * is true (default) and a selection is set. The sidebar shows that list in a
 * separate column, so the tree view passes `includeDocuments: false`.
 * `selection === null` omits the note list. `""` is Untagged.
 */
export function flattenTagView(options: {
  tree: TagTreeNode[];
  expanded: Iterable<string>;
  notes: NoteTags[];
  documentPaths: string[];
  selection: string | null;
  hideSubtagNotes: boolean;
  includeDocuments?: boolean;
}): TagFlatRow[] {
  const expanded = new Set(
    [...options.expanded].map((path) => path.toLowerCase()),
  );
  const rows: TagFlatRow[] = [{ kind: "untagged", key: "untagged" }];
  flattenNodes(options.tree, expanded, 1, rows);
  if (options.includeDocuments === false) return rows;
  if (options.selection == null) return rows;
  const docs = documentsForSelection(
    options.notes,
    options.documentPaths,
    options.selection,
    options.hideSubtagNotes,
  );
  rows.push({ kind: "divider", key: "divider" });
  rows.push({ kind: "listHeader", key: "list-header" });
  if (docs.length === 0) {
    rows.push({ kind: "empty", key: "empty" });
    return rows;
  }
  for (const path of docs) {
    rows.push({ kind: "note", key: `note:${path}`, path });
  }
  return rows;
}

import type { NoteTags } from "./vaultApi";

export type TagGraphNodeKind = "note" | "tag";

export type TagGraphNode = {
  id: string;
  kind: TagGraphNodeKind;
  /** Display label (note stem or tag name). */
  label: string;
  /** Vault-relative path for notes; tag name for tags. */
  key: string;
  /** Number of connected notes (tags) or tags (notes). */
  degree: number;
  /** True when the note has no tags (orphan / untagged). */
  untagged?: boolean;
};

export type TagGraphEdge = {
  id: string;
  source: string;
  target: string;
};

export type TagGraphData = {
  nodes: TagGraphNode[];
  edges: TagGraphEdge[];
};

export type BuildTagGraphOptions = {
  /** Include markdown notes that have no tags. Default false. */
  showUntagged?: boolean;
  /** Only emit tag nodes and co-occurrence edges between tags. Default false. */
  tagsOnly?: boolean;
  /**
   * All vault-relative document paths (`.md` / `.pdf` from the file tree). Used for
   * untagged documents and optional local-graph scoping.
   */
  allNotePaths?: string[];
  /**
   * Optional focus node for a future local graph.
   * - `tag:<name>` or bare tag name → that tag + linked notes (+ their tags at depth ≥ 2)
   * - `note:<path>` or vault path → that note + its tags (+ co-tagged notes at depth ≥ 2)
   */
  root?: string | null;
  /** Hop distance from `root`. Ignored when `root` is unset. Default 1. */
  depth?: number;
};

export function noteNodeId(path: string): string {
  return `note:${path}`;
}

export function tagNodeId(tag: string): string {
  return `tag:${tag.toLowerCase()}`;
}

export function noteLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.md$/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/\.drawio$/i, "")
    .replace(/\.mdlnks$/i, "")
    .replace(/\.mddict$/i, "");
}

function isGraphDocumentPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".pdf");
}

function normalizeRoot(
  root: string | null | undefined,
): { kind: TagGraphNodeKind; key: string } | null {
  if (!root) return null;
  const trimmed = root.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("note:")) {
    return { kind: "note", key: trimmed.slice("note:".length) };
  }
  if (trimmed.startsWith("tag:")) {
    return { kind: "tag", key: trimmed.slice("tag:".length) };
  }
  if (isGraphDocumentPath(trimmed) || trimmed.includes("/")) {
    return { kind: "note", key: trimmed };
  }
  return { kind: "tag", key: trimmed };
}

/**
 * Build a bipartite note↔tag graph (or tags-only co-occurrence graph) from the
 * vault tag index. Pure / serializable — no graphology dependency.
 */
export function buildTagGraph(
  noteTags: NoteTags[],
  options: BuildTagGraphOptions = {},
): TagGraphData {
  const showUntagged = Boolean(options.showUntagged);
  const tagsOnly = Boolean(options.tagsOnly);
  const depth = Math.max(0, options.depth ?? 1);
  const root = normalizeRoot(options.root);

  // Canonical tag casing: first seen wins (case-insensitive).
  const tagCanon = new Map<string, string>();
  const noteTagMap = new Map<string, string[]>();

  for (const entry of noteTags) {
    const path = entry.path.trim();
    if (!isGraphDocumentPath(path)) continue;
    const tags: string[] = [];
    for (const raw of entry.tags) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!tagCanon.has(key)) tagCanon.set(key, name);
      tags.push(tagCanon.get(key)!);
    }
    if (tags.length) noteTagMap.set(path, tags);
  }

  const taggedPaths = new Set(noteTagMap.keys());
  const untaggedPaths: string[] = [];
  if (showUntagged && !tagsOnly) {
    const all = options.allNotePaths ?? [];
    for (const path of all) {
      if (!isGraphDocumentPath(path)) continue;
      if (taggedPaths.has(path)) continue;
      untaggedPaths.push(path);
    }
  }

  // Optional local-graph filter.
  let keepNotes: Set<string> | null = null;
  let keepTags: Set<string> | null = null;
  if (root) {
    keepNotes = new Set();
    keepTags = new Set();
    if (root.kind === "note") {
      keepNotes.add(root.key);
      seedFromNotes(keepNotes, keepTags, noteTagMap, depth);
    } else {
      const key = root.key.toLowerCase();
      const canon = tagCanon.get(key) ?? root.key;
      keepTags.add(canon);
      seedFromTags(keepNotes, keepTags, noteTagMap, depth);
    }
  }

  const tagCounts = new Map<string, number>();
  for (const [path, tags] of noteTagMap) {
    if (keepNotes && !keepNotes.has(path)) continue;
    for (const tag of tags) {
      if (keepTags && !keepTags.has(tag)) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  if (tagsOnly) {
    return buildTagsOnlyGraph(noteTagMap, tagCounts, keepNotes, keepTags);
  }

  const nodes: TagGraphNode[] = [];
  const edges: TagGraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const [tag, count] of tagCounts) {
    if (keepTags && !keepTags.has(tag)) continue;
    nodes.push({
      id: tagNodeId(tag),
      kind: "tag",
      label: tag,
      key: tag,
      degree: count,
    });
  }

  for (const [path, tags] of noteTagMap) {
    if (keepNotes && !keepNotes.has(path)) continue;
    const linked = keepTags ? tags.filter((t) => keepTags!.has(t)) : tags;
    if (!linked.length && keepNotes) continue;
    nodes.push({
      id: noteNodeId(path),
      kind: "note",
      label: noteLabel(path),
      key: path,
      degree: linked.length,
    });
    for (const tag of linked) {
      const eid = `${path}::${tag.toLowerCase()}`;
      if (seenEdges.has(eid)) continue;
      seenEdges.add(eid);
      edges.push({
        id: eid,
        source: noteNodeId(path),
        target: tagNodeId(tag),
      });
    }
  }

  for (const path of untaggedPaths) {
    // Untagged notes only appear in a full (non-local) graph, or when root is the note itself.
    if (root && root.kind === "tag") continue;
    if (root && root.kind === "note" && root.key !== path) continue;
    nodes.push({
      id: noteNodeId(path),
      kind: "note",
      label: noteLabel(path),
      key: path,
      degree: 0,
      untagged: true,
    });
  }

  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "tag" ? -1 : 1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });

  return { nodes, edges };
}

function seedFromNotes(
  keepNotes: Set<string>,
  keepTags: Set<string>,
  noteTagMap: Map<string, string[]>,
  depth: number,
): void {
  let frontierNotes = new Set(keepNotes);
  for (let d = 0; d < depth; d++) {
    const nextTags = new Set<string>();
    for (const path of frontierNotes) {
      for (const tag of noteTagMap.get(path) ?? []) {
        if (!keepTags.has(tag)) {
          keepTags.add(tag);
          nextTags.add(tag);
        }
      }
    }
    if (d + 1 >= depth) break;
    const nextNotes = new Set<string>();
    for (const [path, tags] of noteTagMap) {
      if (keepNotes.has(path)) continue;
      if (tags.some((t) => nextTags.has(t))) {
        keepNotes.add(path);
        nextNotes.add(path);
      }
    }
    frontierNotes = nextNotes;
    if (!frontierNotes.size) break;
  }
}

function seedFromTags(
  keepNotes: Set<string>,
  keepTags: Set<string>,
  noteTagMap: Map<string, string[]>,
  depth: number,
): void {
  let frontierTags = new Set(keepTags);
  for (let d = 0; d < depth; d++) {
    const nextNotes = new Set<string>();
    for (const [path, tags] of noteTagMap) {
      if (keepNotes.has(path)) continue;
      if (tags.some((t) => frontierTags.has(t))) {
        keepNotes.add(path);
        nextNotes.add(path);
      }
    }
    if (d + 1 >= depth) break;
    const nextTags = new Set<string>();
    for (const path of nextNotes) {
      for (const tag of noteTagMap.get(path) ?? []) {
        if (!keepTags.has(tag)) {
          keepTags.add(tag);
          nextTags.add(tag);
        }
      }
    }
    frontierTags = nextTags;
    if (!frontierTags.size) break;
  }
}

function buildTagsOnlyGraph(
  noteTagMap: Map<string, string[]>,
  tagCounts: Map<string, number>,
  keepNotes: Set<string> | null,
  keepTags: Set<string> | null,
): TagGraphData {
  const pairWeight = new Map<string, number>();

  for (const [path, tags] of noteTagMap) {
    if (keepNotes && !keepNotes.has(path)) continue;
    const filtered = keepTags ? tags.filter((t) => keepTags.has(t)) : tags;
    const unique = [...new Set(filtered.map((t) => t))];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!;
        const b = unique[j]!;
        const [lo, hi] =
          a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
        const key = `${lo.toLowerCase()}::${hi.toLowerCase()}`;
        pairWeight.set(key, (pairWeight.get(key) ?? 0) + 1);
      }
    }
  }

  const nodes: TagGraphNode[] = [];
  for (const [tag, count] of tagCounts) {
    if (keepTags && !keepTags.has(tag)) continue;
    nodes.push({
      id: tagNodeId(tag),
      kind: "tag",
      label: tag,
      key: tag,
      degree: count,
    });
  }
  nodes.sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );

  const edges: TagGraphEdge[] = [];
  for (const [key, weight] of pairWeight) {
    if (weight < 1) continue;
    const [a, b] = key.split("::");
    if (!a || !b) continue;
    edges.push({
      id: key,
      source: tagNodeId(a),
      target: tagNodeId(b),
    });
  }

  return { nodes, edges };
}

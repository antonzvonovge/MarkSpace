/**
 * Segment cache for the Live → markdown export.
 *
 * Serializing a whole note on every keystroke costs ~190ms on a 60KB document,
 * and typing a single character only ever invalidates one paragraph. This keeps
 * the markdown of each top-level segment around and rebuilds only the ones
 * BlockNote reported as changed.
 *
 * The cache never decides what gets saved: `NoteEditor` forces a full rebuild
 * before persisting, so a stale segment can at worst show a briefly wrong word
 * count, never write wrong bytes to disk.
 */

/** Minimal shape we need from a BlockNote block; keeps this module testable. */
export type SegmentBlock = {
  id: string;
  type: string;
  children?: SegmentBlock[];
};

export type Segment<B extends SegmentBlock> = {
  /** Stable across content edits, changes when the run's membership changes. */
  key: string;
  blocks: B[];
};

const LIST_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);

/**
 * Split top-level blocks into independently serializable runs.
 *
 * A run of list items of the same type has to stay together: the HTML exporter
 * only writes the `start` attribute when it is not 1, so serializing a slice
 * that begins mid-list would restart the numbering at one. Keeping whole lists
 * intact also leaves `renestListChildren` all the siblings it expects.
 */
export function splitIntoSegments<B extends SegmentBlock>(
  blocks: B[],
): Segment<B>[] {
  const segments: Segment<B>[] = [];
  let run: B[] = [];
  let runType: string | null = null;

  const flush = () => {
    if (run.length === 0) return;
    segments.push({ key: run.map((b) => b.id).join("|"), blocks: run });
    run = [];
    runType = null;
  };

  for (const block of blocks) {
    if (LIST_TYPES.has(block.type)) {
      if (runType !== null && runType !== block.type) flush();
      runType = block.type;
      run.push(block);
      continue;
    }
    flush();
    segments.push({ key: block.id, blocks: [block] });
  }
  flush();
  return segments;
}

export type SerializeSegment<B extends SegmentBlock> = (blocks: B[]) => string;

export class SegmentMarkdownCache<B extends SegmentBlock> {
  private cache = new Map<string, string>();
  private dirtyBlockIds = new Set<string>();
  private forceFull = true;

  /** Record ids reported by `getChanges()` since the last serialization. */
  markDirty(blockIds: Iterable<string>): void {
    for (const id of blockIds) this.dirtyBlockIds.add(id);
  }

  /** Drop everything: used for paste, drop, undo/redo and remote edits. */
  invalidateAll(): void {
    this.cache.clear();
    this.dirtyBlockIds.clear();
    this.forceFull = true;
  }

  /** True when the next `serialize` cannot reuse anything. */
  get isColdStart(): boolean {
    return this.forceFull;
  }

  serialize(blocks: B[], serializeSegment: SerializeSegment<B>): string {
    const segments = splitIntoSegments(blocks);
    const next = new Map<string, string>();
    const parts: string[] = [];

    for (const segment of segments) {
      const cached = this.forceFull ? undefined : this.cache.get(segment.key);
      const isDirty =
        cached === undefined || containsAny(segment.blocks, this.dirtyBlockIds);
      const markdown = isDirty ? serializeSegment(segment.blocks) : cached;
      next.set(segment.key, markdown);
      parts.push(markdown);
    }

    // Rebuilt from the live segment list, so deleted blocks cannot pile up.
    this.cache = next;
    this.dirtyBlockIds.clear();
    this.forceFull = false;
    return joinSegments(parts);
  }
}

/**
 * Nested blocks are serialized with their top-level ancestor, but `getChanges`
 * reports the child's own id, so dirtiness has to be checked down the subtree.
 */
function containsAny(blocks: SegmentBlock[], ids: Set<string>): boolean {
  if (ids.size === 0) return false;
  for (const block of blocks) {
    if (ids.has(block.id)) return true;
    if (block.children?.length && containsAny(block.children, ids)) return true;
  }
  return false;
}

/**
 * Changes we do not try to be clever about.
 *
 * Pasting, dropping and undo can rewrite the document wholesale, and remote
 * Yjs edits arrive without a local transaction to diff against.
 */
const UNSAFE_SOURCES = new Set([
  "paste",
  "drop",
  "undo",
  "redo",
  "undo-redo",
  "yjs-remote",
]);

type BlockChange = {
  type: string;
  source?: { type?: string };
  block?: { id?: string };
  prevBlock?: { id?: string };
};

export type ChangeContext = { getChanges: () => BlockChange[] };

/**
 * Feed a BlockNote `onChange` context into the cache.
 *
 * Anything unexpected — a throw, an empty change list on a real edit, a block
 * move — drops the whole cache. `getChanges()` is young enough to have shipped
 * bugs where it reported nothing for a change, and a missed invalidation is
 * the one failure mode worth spending a rebuild to avoid.
 */
export function recordSegmentChanges(
  cache: SegmentMarkdownCache<SegmentBlock>,
  context: ChangeContext | undefined,
): void {
  if (!context?.getChanges) {
    cache.invalidateAll();
    return;
  }
  let changes: BlockChange[];
  try {
    changes = context.getChanges();
  } catch {
    cache.invalidateAll();
    return;
  }
  if (changes.length === 0) {
    cache.invalidateAll();
    return;
  }
  const ids: string[] = [];
  for (const change of changes) {
    if (change.type === "move" || UNSAFE_SOURCES.has(change.source?.type ?? "")) {
      cache.invalidateAll();
      return;
    }
    if (change.block?.id) ids.push(change.block.id);
    if (change.prevBlock?.id) ids.push(change.prevBlock.id);
  }
  cache.markDirty(ids);
}

/**
 * Re-create the blank line that separates top-level blocks.
 *
 * `htmlToMarkdown` trims each result and appends a single newline, so the
 * segments arrive without the separator that a whole-document export would
 * have produced between them.
 */
export function joinSegments(parts: string[]): string {
  const trimmed = parts.map((p) => p.replace(/\n+$/, "")).filter((p) => p !== "");
  if (trimmed.length === 0) return "\n";
  return `${trimmed.join("\n\n")}\n`;
}

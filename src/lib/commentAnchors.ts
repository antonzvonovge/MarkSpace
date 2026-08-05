/** Find and track comment ranges via structural anchors + quote fallback. */

import type { Node as PmNode } from "@tiptap/pm/model";
import type { Mapping } from "@tiptap/pm/transform";

/**
 * Sidecar structural anchor — survives markdown reload better than quote alone.
 * Does not live in the note body.
 */
export type StructuralAnchor = {
  kind: "text" | "leaf" | "span";
  startHash: string;
  startType: string;
  /** 0-based among blocks that share startHash at capture time. */
  startOcc: number;
  /** Offset into the start block's plain-text stream. */
  startOffset: number;
  endHash: string;
  endType: string;
  endOcc: number;
  /** Offset into the end block's plain-text stream (exclusive). */
  endOffset: number;
  /** Leaf identity when kind is leaf (also set for leaf-only spans). */
  leafType?: string;
  leafKey?: string;
};

export type CommentAnchor = {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  resolved: boolean;
  anchor?: StructuralAnchor | null;
};

export type CommentRange = {
  id: string;
  from: number;
  to: number;
  resolved: boolean;
};

/** Anchor that drifted from stored sidecar fields (needs persist). */
export type CommentAnchorUpdate = {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  anchor: StructuralAnchor;
};

const CONTEXT_LEN = 24;

/**
 * Stands in for a non-text leaf (image, diagram, equation) so a selection that
 * covers one still yields a matchable quote.
 */
export const LEAF_PLACEHOLDER = "\uFFFC";

/** Selection text using the same rules as {@link collectPlainText}. */
export function plainTextBetween(doc: PmNode, from: number, to: number): string {
  return doc.textBetween(from, to, "", LEAF_PLACEHOLDER);
}

/** Human-readable quote for UI: leaf placeholders are not renderable. */
export function commentQuoteLabel(quote: string): string {
  const leaves = quote.split(LEAF_PLACEHOLDER).length - 1;
  const withoutLeaves = quote.split(LEAF_PLACEHOLDER).join("").trim();
  if (leaves > 0 && !withoutLeaves) {
    return leaves > 1 ? "Embedded blocks" : "Embedded block";
  }
  return quote.split(LEAF_PLACEHOLDER).join("▢").trim();
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable leaf identity from PM attrs / type. */
export function leafIdentity(
  node: PmNode,
): { type: string; key: string } | null {
  if (!node.isLeaf || node.isText) return null;
  const type = node.type.name;
  const a = node.attrs as Record<string, unknown>;
  if (type === "image" || type === "file" || type === "video" || type === "audio") {
    const url = typeof a.url === "string" ? a.url : "";
    return { type, key: url || type };
  }
  if (type === "mermaid" || type === "plantuml") {
    const code = typeof a.code === "string" ? a.code : "";
    return { type, key: fnv1a(code) };
  }
  if (type === "drawio") {
    const src = typeof a.src === "string" ? a.src : "";
    return { type, key: src || type };
  }
  if (type === "equation") {
    const latex = typeof a.latex === "string" ? a.latex : "";
    return { type, key: fnv1a(latex) };
  }
  if (type === "latex") {
    const latex = typeof a.latex === "string" ? a.latex : "";
    return { type, key: fnv1a(latex) };
  }
  return { type, key: fnv1a(JSON.stringify(a ?? {})) };
}

type BlockSlice = {
  /** Position of the blockContent (or leaf) node. */
  pos: number;
  node: PmNode;
  type: string;
  hash: string;
  /** Occurrence among blocks with the same hash (document order). */
  occ: number;
  /** Plain stream for this block only. */
  text: string;
  map: number[];
  endMap: number[];
  leaf?: { type: string; key: string };
};

function appendNodePlain(
  node: PmNode,
  pos: number,
  text: { value: string },
  map: number[],
  endMap: number[],
): void {
  if (node.isText && node.text) {
    for (let i = 0; i < node.text.length; i++) {
      map.push(pos + i);
      endMap.push(pos + i + 1);
      text.value += node.text[i];
    }
    return;
  }
  if (node.isLeaf) {
    map.push(pos);
    endMap.push(pos + node.nodeSize);
    text.value += LEAF_PLACEHOLDER;
  }
}

function collectInside(node: PmNode, basePos: number): {
  text: string;
  map: number[];
  endMap: number[];
} {
  const text = { value: "" };
  const map: number[] = [];
  const endMap: number[] = [];
  if (node.isLeaf || node.isText) {
    appendNodePlain(node, basePos, text, map, endMap);
    return { text: text.value, map, endMap };
  }
  node.descendants((child, rel) => {
    const abs = basePos + 1 + rel;
    if (child.isText && child.text) {
      appendNodePlain(child, abs, text, map, endMap);
      return false;
    }
    if (child.isLeaf) {
      appendNodePlain(child, abs, text, map, endMap);
      return false;
    }
    return true;
  });
  return { text: text.value, map, endMap };
}

function fingerprintContent(node: PmNode): string {
  const leaf = leafIdentity(node);
  if (leaf) return `leaf:${leaf.type}:${leaf.key}`;
  const { text } = collectInside(node, 0);
  return `text:${text}`;
}

/**
 * Enumerate BlockNote blockContent nodes (and loose leaves) with stable hashes.
 */
export function listBlockSlices(doc: PmNode): BlockSlice[] {
  const raw: Omit<BlockSlice, "occ">[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "blockContainer") {
      // Content is usually first child; skip empty containers.
      const content = node.firstChild;
      if (!content) return false;
      // Nested blockGroup is second child — still index the content node only.
      if (content.type.name === "blockGroup") return true;
      const type = content.type.name;
      const contentPos = pos + 1;
      const { text, map, endMap } = collectInside(content, contentPos);
      const leaf = leafIdentity(content) ?? undefined;
      const hash = fnv1a(`${type}\0${fingerprintContent(content)}`);
      raw.push({
        pos: contentPos,
        node: content,
        type,
        hash,
        text,
        map,
        endMap,
        leaf,
      });
      return true; // continue into nested blockGroup if any
    }

    // Inline latex atoms live inside paragraph content — also index as slices
    // when they are the selection target.
    if (node.type.name === "latex" && node.isLeaf) {
      const leaf = leafIdentity(node)!;
      const { text, map, endMap } = collectInside(node, pos);
      const hash = fnv1a(`latex\0${fingerprintContent(node)}`);
      raw.push({
        pos,
        node,
        type: "latex",
        hash,
        text,
        map,
        endMap,
        leaf,
      });
      return false;
    }
    return true;
  });

  const counts = new Map<string, number>();
  const out: BlockSlice[] = [];
  for (const b of raw) {
    const occ = counts.get(b.hash) ?? 0;
    counts.set(b.hash, occ + 1);
    out.push({ ...b, occ });
  }
  return out;
}

function sliceAtPos(slices: BlockSlice[], pos: number): BlockSlice | null {
  // Prefer the innermost / latest slice that contains pos.
  let best: BlockSlice | null = null;
  for (const s of slices) {
    const end = s.pos + s.node.nodeSize;
    if (pos >= s.pos && pos < end) best = s;
  }
  return best;
}

function offsetInSlice(slice: BlockSlice, docPos: number, bias: "start" | "end"): number {
  if (slice.map.length === 0) return 0;
  if (bias === "start") {
    for (let i = 0; i < slice.map.length; i++) {
      if (slice.map[i]! >= docPos) return i;
    }
    return slice.map.length;
  }
  for (let i = slice.endMap.length - 1; i >= 0; i--) {
    if (slice.endMap[i]! <= docPos) return i + 1;
  }
  return 0;
}

function findSlice(
  slices: BlockSlice[],
  hash: string,
  type: string,
  occ: number,
): BlockSlice | null {
  if (!hash) return null;
  const matches = slices.filter((s) => s.hash === hash && s.type === type);
  if (matches.length === 0) return null;
  return matches[occ] ?? matches[0] ?? null;
}

function findLeafSlice(
  slices: BlockSlice[],
  leafType: string,
  leafKey: string,
): BlockSlice | null {
  const matches = slices.filter(
    (s) => s.leaf && s.leaf.type === leafType && s.leaf.key === leafKey,
  );
  return matches[0] ?? null;
}

function rangeFromOffsets(
  start: BlockSlice,
  startOffset: number,
  end: BlockSlice,
  endOffset: number,
): { from: number; to: number } | null {
  if (start.map.length === 0 && end.map.length === 0) {
    // Empty text block — cannot anchor.
    if (!start.leaf && !end.leaf) return null;
  }
  const clampStart = Math.max(0, Math.min(startOffset, start.map.length));
  const clampEnd = Math.max(0, Math.min(endOffset, end.endMap.length));

  let from: number;
  let to: number;
  if (start.map.length === 0 && start.leaf) {
    from = start.pos;
  } else if (clampStart >= start.map.length) {
    from = start.endMap[start.endMap.length - 1] ?? start.pos + start.node.nodeSize;
  } else {
    from = start.map[clampStart]!;
  }

  if (end.map.length === 0 && end.leaf) {
    to = end.pos + end.node.nodeSize;
  } else if (clampEnd <= 0) {
    to = end.map[0] ?? end.pos;
  } else {
    to = end.endMap[clampEnd - 1]!;
  }

  if (from >= to) {
    // Same leaf with empty plain — still select the node.
    if (start === end && start.leaf) {
      return { from: start.pos, to: start.pos + start.node.nodeSize };
    }
    return null;
  }
  return { from, to };
}

export function collectPlainText(doc: PmNode): {
  text: string;
  map: number[];
  endMap: number[];
} {
  let text = "";
  const map: number[] = [];
  const endMap: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        map.push(pos + i);
        endMap.push(pos + i + 1);
        text += node.text[i];
      }
      return false;
    }
    if (node.isLeaf) {
      map.push(pos);
      endMap.push(pos + node.nodeSize);
      text += LEAF_PLACEHOLDER;
      return false;
    }
    return true;
  });
  return { text, map, endMap };
}

function findQuoteIndex(
  haystack: string,
  quote: string,
  prefix: string,
  suffix: string,
): number {
  if (!quote) return -1;
  const withContext = `${prefix}${quote}${suffix}`;
  if (prefix || suffix) {
    const ctx = haystack.indexOf(withContext);
    if (ctx >= 0) return ctx + prefix.length;
  }
  return haystack.indexOf(quote);
}

function resolveStructural(
  doc: PmNode,
  anchor: StructuralAnchor,
): { from: number; to: number } | null {
  if (
    !anchor.leafKey &&
    !anchor.startHash &&
    !anchor.endHash
  ) {
    return null;
  }
  const slices = listBlockSlices(doc);

  if (anchor.kind === "leaf" && anchor.leafType && anchor.leafKey) {
    const leaf = findLeafSlice(slices, anchor.leafType, anchor.leafKey);
    if (leaf) {
      return { from: leaf.pos, to: leaf.pos + leaf.node.nodeSize };
    }
  }

  if (!anchor.startHash || !anchor.endHash) return null;

  const start = findSlice(
    slices,
    anchor.startHash,
    anchor.startType,
    anchor.startOcc,
  );
  const end = findSlice(slices, anchor.endHash, anchor.endType, anchor.endOcc);
  if (!start || !end) return null;
  return rangeFromOffsets(start, anchor.startOffset, end, anchor.endOffset);
}

function resolveByQuote(
  doc: PmNode,
  quote: string,
  prefix: string,
  suffix: string,
  claimed: Set<number>,
): { from: number; to: number; claimFrom: number; claimLen: number } | null {
  const { text, map, endMap } = collectPlainText(doc);
  if (!text || map.length === 0 || !quote) return null;

  let searchFrom = 0;
  while (searchFrom <= text.length) {
    const slice = text.slice(searchFrom);
    let local = findQuoteIndex(slice, quote, prefix, suffix);
    if (local < 0) local = slice.indexOf(quote);
    if (local < 0) break;
    const abs = searchFrom + local;
    let overlap = false;
    for (let i = 0; i < quote.length; i++) {
      if (claimed.has(abs + i)) {
        overlap = true;
        break;
      }
    }
    if (!overlap) {
      if (abs >= map.length) return null;
      const endIdx = Math.min(abs + quote.length - 1, map.length - 1);
      return {
        from: map[abs]!,
        to: endMap[endIdx]!,
        claimFrom: abs,
        claimLen: quote.length,
      };
    }
    searchFrom = abs + 1;
  }
  return null;
}

/**
 * Resolve each comment to a document range: structural first, quote fallback.
 */
export function findCommentRanges(
  doc: PmNode,
  comments: CommentAnchor[],
): CommentRange[] {
  const claimed = new Set<number>();
  const out: CommentRange[] = [];
  const { text } = collectPlainText(doc);

  for (const c of comments) {
    let range: { from: number; to: number } | null = null;

    if (c.anchor) {
      range = resolveStructural(doc, c.anchor);
    }

    if (!range) {
      const byQuote = resolveByQuote(doc, c.quote, c.prefix, c.suffix, claimed);
      if (byQuote) {
        range = { from: byQuote.from, to: byQuote.to };
        for (let i = 0; i < byQuote.claimLen; i++) {
          claimed.add(byQuote.claimFrom + i);
        }
      }
    } else if (text) {
      // Mark plain indices covered so quote fallback for others skips them.
      const plain = collectPlainText(doc);
      for (let i = 0; i < plain.map.length; i++) {
        const p = plain.map[i]!;
        const e = plain.endMap[i]!;
        if (e > range.from && p < range.to) claimed.add(i);
      }
    }

    if (!range || range.from >= range.to) continue;
    if (range.to > doc.content.size) continue;
    out.push({ id: c.id, from: range.from, to: range.to, resolved: c.resolved });
  }

  return out;
}

/** Map tracked ranges through a document change; drop collapsed ones. */
export function mapCommentRanges(
  ranges: CommentRange[],
  mapping: Mapping,
  docSize: number,
): CommentRange[] {
  const out: CommentRange[] = [];
  for (const r of ranges) {
    const from = mapping.map(r.from, -1);
    const to = mapping.map(r.to, 1);
    if (from >= to) continue;
    if (from < 0 || to > docSize) continue;
    out.push({ id: r.id, from, to, resolved: r.resolved });
  }
  return out;
}

/**
 * Merge store comments with live mapped ranges: keep positions for known ids,
 * resolve new ids structurally / by quote.
 */
export function syncCommentRanges(
  doc: PmNode,
  comments: CommentAnchor[],
  prevRanges: CommentRange[],
): CommentRange[] {
  const byId = new Map(prevRanges.map((r) => [r.id, r]));
  const out: CommentRange[] = [];
  const needFind: CommentAnchor[] = [];

  for (const c of comments) {
    const prev = byId.get(c.id);
    if (prev && prev.from < prev.to && prev.to <= doc.content.size) {
      out.push({
        id: c.id,
        from: prev.from,
        to: prev.to,
        resolved: c.resolved,
      });
    } else {
      needFind.push(c);
    }
  }

  if (needFind.length === 0) return out;

  const claimed = new Set<string>();
  for (const r of out) {
    for (let p = r.from; p < r.to; p++) claimed.add(`${p}`);
  }

  const found = findCommentRanges(doc, needFind);
  for (const r of found) {
    let overlap = false;
    for (let p = r.from; p < r.to; p++) {
      if (claimed.has(`${p}`)) {
        overlap = true;
        break;
      }
    }
    if (overlap) continue;
    for (let p = r.from; p < r.to; p++) claimed.add(`${p}`);
    out.push(r);
  }
  return out;
}

/** Build structural + quote fields for a live selection. */
export function captureCommentAnchor(
  doc: PmNode,
  from: number,
  to: number,
): {
  quote: string;
  prefix: string;
  suffix: string;
  anchor: StructuralAnchor;
} | null {
  if (from >= to) return null;
  const quote = plainTextBetween(doc, from, to).trim();
  if (!quote) return null;
  const prefix = plainTextBetween(doc, Math.max(0, from - CONTEXT_LEN), from);
  const suffix = plainTextBetween(
    doc,
    to,
    Math.min(doc.content.size, to + CONTEXT_LEN),
  );

  const slices = listBlockSlices(doc);
  const startSlice = sliceAtPos(slices, from);
  const endSlice = sliceAtPos(slices, Math.max(from, to - 1));
  if (!startSlice || !endSlice) {
    // Degenerate: still store a quote-only anchor shell.
    return {
      quote,
      prefix,
      suffix,
      anchor: {
        kind: "text",
        startHash: "",
        startType: "",
        startOcc: 0,
        startOffset: 0,
        endHash: "",
        endType: "",
        endOcc: 0,
        endOffset: 0,
      },
    };
  }

  const startOffset = offsetInSlice(startSlice, from, "start");
  const endOffset = offsetInSlice(endSlice, to, "end");

  const same = startSlice === endSlice;
  if (same && startSlice.leaf && startOffset === 0 && endOffset >= startSlice.map.length) {
    return {
      quote,
      prefix,
      suffix,
      anchor: {
        kind: "leaf",
        startHash: startSlice.hash,
        startType: startSlice.type,
        startOcc: startSlice.occ,
        startOffset: 0,
        endHash: endSlice.hash,
        endType: endSlice.type,
        endOcc: endSlice.occ,
        endOffset: endSlice.map.length || 1,
        leafType: startSlice.leaf.type,
        leafKey: startSlice.leaf.key,
      },
    };
  }

  const kind: StructuralAnchor["kind"] = same ? "text" : "span";
  return {
    quote,
    prefix,
    suffix,
    anchor: {
      kind,
      startHash: startSlice.hash,
      startType: startSlice.type,
      startOcc: startSlice.occ,
      startOffset,
      endHash: endSlice.hash,
      endType: endSlice.type,
      endOcc: endSlice.occ,
      endOffset,
      ...(startSlice.leaf && endSlice.leaf && startSlice.leaf.key === endSlice.leaf.key
        ? { leafType: startSlice.leaf.type, leafKey: startSlice.leaf.key }
        : {}),
    },
  };
}

/** Read quote + context + structural fields at a live range. */
export function extractAnchorAtRange(
  doc: PmNode,
  from: number,
  to: number,
): {
  quote: string;
  prefix: string;
  suffix: string;
  anchor: StructuralAnchor;
} | null {
  return captureCommentAnchor(doc, from, to);
}

/** Compare live ranges to stored anchors; return drifted ones. */
export function detectAnchorUpdates(
  doc: PmNode,
  comments: CommentAnchor[],
  ranges: CommentRange[],
): CommentAnchorUpdate[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const updates: CommentAnchorUpdate[] = [];
  for (const r of ranges) {
    const stored = byId.get(r.id);
    if (!stored) continue;
    const live = extractAnchorAtRange(doc, r.from, r.to);
    if (!live) continue;
    const sameQuote =
      live.quote === stored.quote &&
      live.prefix === stored.prefix &&
      live.suffix === stored.suffix;
    const sa = stored.anchor;
    const sameStruct =
      sa &&
      sa.kind === live.anchor.kind &&
      sa.startHash === live.anchor.startHash &&
      sa.startOffset === live.anchor.startOffset &&
      sa.endHash === live.anchor.endHash &&
      sa.endOffset === live.anchor.endOffset &&
      sa.startOcc === live.anchor.startOcc &&
      sa.endOcc === live.anchor.endOcc &&
      (sa.leafKey ?? "") === (live.anchor.leafKey ?? "") &&
      (sa.leafType ?? "") === (live.anchor.leafType ?? "");
    if (sameQuote && sameStruct) continue;
    updates.push({ id: r.id, ...live });
  }
  return updates;
}

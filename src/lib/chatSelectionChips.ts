/**
 * Selection / comment chips: text (or a note comment) dropped into the
 * composer as a compact chip. The full payload materializes when the message
 * is sent, as a quoted block that names its source file.
 *
 * Path / skill / tool markers from the composer are kept in stored user text
 * so bubbles can render them as chips; the model sees unwrapped plain text.
 */

/** Markers for selection chips in the chat composer draft string. */
export const SELECTION_OPEN = "⟬";
export const SELECTION_CLOSE = "⟭";

const SELECTION_MARKER_RE = /⟬([^⟭]*)⟭/g;
const INLINE_CHIP_MARKER_RE = /⟦([^⟧]*)⟧|⦃([^⦄]*)⦄|⟪([^⟫]*)⟫/g;

export const MAX_SELECTION_CHARS = 20_000;

export type ChatChipKind = "selection" | "comment";

export type ChatSelectionRef = {
  id: string;
  /**
   * Selection text, or comment body when kind is "comment".
   * May be multi-line.
   */
  text: string;
  /** Vault-relative path the selection/comment came from, or null. */
  sourcePath: string | null;
  /** Defaults to "selection". */
  kind?: ChatChipKind;
  /** Quoted note span for comment chips. */
  quote?: string;
};

export function wrapSelectionMarker(id: string): string {
  const safe = id.replace(/[⟬⟭]/g, "");
  return `${SELECTION_OPEN}${safe}${SELECTION_CLOSE}`;
}

/** Selection ids referenced by the draft, in document order (deduped). */
export function extractSelectionIds(draft: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  SELECTION_MARKER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELECTION_MARKER_RE.exec(draft))) {
    const id = (match[1] ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const CHIP_LABEL_MAX = 28;

/** Chip label: start of the selection on one line, ellipsized. */
export function selectionChipLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "Selection…";
  if (flat.length <= CHIP_LABEL_MAX) return flat;
  const head = flat.slice(0, CHIP_LABEL_MAX);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace >= CHIP_LABEL_MAX / 2 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

/** Composer / bubble chip label for a comment (prefers body, else quote). */
export function commentChipLabel(ref: {
  text: string;
  quote?: string;
}): string {
  const body = ref.text.replace(/\s+/g, " ").trim();
  if (body) {
    const label = selectionChipLabel(body);
    return label === "Selection…" ? "Comment…" : label;
  }
  const quote = (ref.quote ?? "").replace(/\s+/g, " ").trim();
  if (quote) {
    const label = selectionChipLabel(quote);
    return label === "Selection…" ? "Comment…" : label;
  }
  return "Comment…";
}

export function truncateSelection(text: string): string {
  if (text.length <= MAX_SELECTION_CHARS) return text;
  return `${text.slice(0, MAX_SELECTION_CHARS)}\n…[truncated]`;
}

function quoteLines(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
}

function unquoteLines(block: string): string {
  return block
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => (line.startsWith("> ") ? line.slice(2) : line.slice(1)))
    .join("\n");
}

const SELECTION_HEADER = "Selection";
const COMMENT_HEADER = "Comment";

/** Quoted block sent to the model in place of a chip. */
export function formatSelectionBlock(ref: ChatSelectionRef): string {
  if (ref.kind === "comment") {
    const header = ref.sourcePath
      ? `${COMMENT_HEADER} from ${ref.sourcePath}:`
      : `${COMMENT_HEADER}:`;
    const quote = truncateSelection((ref.quote ?? "").trim());
    const body = truncateSelection(ref.text.trim());
    const parts = [header];
    if (quote) {
      parts.push("Quote:", quoteLines(quote));
    }
    if (body) {
      parts.push("Body:", quoteLines(body));
    }
    return parts.join("\n");
  }
  const header = ref.sourcePath
    ? `${SELECTION_HEADER} from ${ref.sourcePath}:`
    : `${SELECTION_HEADER}:`;
  return `${header}\n${quoteLines(truncateSelection(ref.text))}`;
}

const SELECTION_BLOCK_RE =
  /(?:^|\n)Selection(?: from ([^\n]*?))?:\n((?:>[^\n]*(?:\n|$))+)/g;

/**
 * Comment blocks include optional Quote/Body sections so the bubble can
 * restore quote + body and the model always sees the note path.
 */
const COMMENT_BLOCK_RE =
  /(?:^|\n)Comment(?: from ([^\n]*?))?:\n(?:Quote:\n((?:>[^\n]*(?:\n|$))+))?(?:\n?Body:\n((?:>[^\n]*(?:\n|$))+))?/g;

/** Replace chip markers with their quoted blocks (unknown ids are dropped). */
export function expandSelectionMarkers(
  draft: string,
  refs: Record<string, ChatSelectionRef>,
): string {
  SELECTION_MARKER_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  // A block owns its own blank lines; spaces that hugged the chip must go.
  let trimNextLeft = false;
  let match: RegExpExecArray | null;

  const append = (chunk: string) => {
    out += trimNextLeft ? chunk.replace(/^[ \t]+/, "") : chunk;
    trimNextLeft = false;
  };

  while ((match = SELECTION_MARKER_RE.exec(draft))) {
    append(draft.slice(last, match.index));
    last = match.index + match[0].length;
    const ref = refs[(match[1] ?? "").trim()];
    if (!ref) continue;
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n\n")) out += out.endsWith("\n") ? "\n" : "\n\n";
    out += `${formatSelectionBlock(ref)}\n\n`;
    trimNextLeft = true;
  }
  append(draft.slice(last));

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export type UserTextSegment =
  | { kind: "text"; text: string }
  | { kind: "selection"; text: string; sourcePath: string | null }
  | {
      kind: "comment";
      text: string;
      quote: string;
      sourcePath: string | null;
    }
  | { kind: "path"; path: string }
  | { kind: "skill"; id: string }
  | { kind: "tool"; id: string };

/** Split inline path/skill/tool markers inside a plain-text run. */
function parseInlineChipSegments(text: string): UserTextSegment[] {
  const segments: UserTextSegment[] = [];
  INLINE_CHIP_MARKER_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_CHIP_MARKER_RE.exec(text))) {
    if (match.index > last) {
      segments.push({ kind: "text", text: text.slice(last, match.index) });
    }
    if (match[1] != null) {
      segments.push({ kind: "path", path: match[1] });
    } else if (match[2] != null) {
      segments.push({ kind: "skill", id: match[2] });
    } else if (match[3] != null) {
      segments.push({ kind: "tool", id: match[3] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments;
}

type BlockHit = {
  index: number;
  length: number;
  segment: UserTextSegment;
};

function collectBlockHits(text: string): BlockHit[] {
  const hits: BlockHit[] = [];

  SELECTION_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELECTION_BLOCK_RE.exec(text))) {
    hits.push({
      index: match.index,
      length: match[0].length,
      segment: {
        kind: "selection",
        text: unquoteLines(match[2] ?? ""),
        sourcePath: match[1]?.trim() || null,
      },
    });
  }

  COMMENT_BLOCK_RE.lastIndex = 0;
  while ((match = COMMENT_BLOCK_RE.exec(text))) {
    const quoteRaw = match[2] ?? "";
    const bodyRaw = match[3] ?? "";
    // Skip empty matches (header alone with no Quote/Body).
    if (!quoteRaw && !bodyRaw) continue;
    hits.push({
      index: match.index,
      length: match[0].length,
      segment: {
        kind: "comment",
        quote: quoteRaw ? unquoteLines(quoteRaw) : "",
        text: bodyRaw ? unquoteLines(bodyRaw) : "",
        sourcePath: match[1]?.trim() || null,
      },
    });
  }

  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  // Drop overlaps (keep earlier / longer).
  const out: BlockHit[] = [];
  let end = 0;
  for (const hit of hits) {
    if (hit.index < end) continue;
    out.push(hit);
    end = hit.index + hit.length;
  }
  return out;
}

/** Split a sent user message back into plain text and chips. */
export function parseUserTextSegments(text: string): UserTextSegment[] {
  const segments: UserTextSegment[] = [];
  const hits = collectBlockHits(text);
  let last = 0;

  const pushText = (raw: string) => {
    const trimmed = raw.replace(/^\n+|\n+$/g, "");
    if (!trimmed) return;
    for (const part of parseInlineChipSegments(trimmed)) {
      segments.push(part);
    }
  };

  for (const hit of hits) {
    pushText(text.slice(last, hit.index));
    segments.push(hit.segment);
    last = hit.index + hit.length;
  }
  pushText(text.slice(last));

  return segments;
}

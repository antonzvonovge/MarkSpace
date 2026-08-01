/**
 * Selection chips: text picked up from the note editor (or chat) and dropped
 * into the composer as a compact chip. The full text only materializes when
 * the message is sent, as a quoted block that names its source file.
 */

/** Markers for selection chips in the chat composer draft string. */
export const SELECTION_OPEN = "⟬";
export const SELECTION_CLOSE = "⟭";

const SELECTION_MARKER_RE = /⟬([^⟭]*)⟭/g;

export const MAX_SELECTION_CHARS = 20_000;

export type ChatSelectionRef = {
  id: string;
  /** Selected text, verbatim (may be multi-line). */
  text: string;
  /** Vault-relative path the selection came from, or null. */
  sourcePath: string | null;
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

const HEADER_PREFIX = "Selection";

/** Quoted block sent to the model in place of a chip. */
export function formatSelectionBlock(ref: ChatSelectionRef): string {
  const header = ref.sourcePath
    ? `${HEADER_PREFIX} from ${ref.sourcePath}:`
    : `${HEADER_PREFIX}:`;
  return `${header}\n${quoteLines(truncateSelection(ref.text))}`;
}

const SELECTION_BLOCK_RE =
  /(?:^|\n)Selection(?: from ([^\n]*?))?:\n((?:>[^\n]*(?:\n|$))+)/g;

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
  | { kind: "selection"; text: string; sourcePath: string | null };

/** Split a sent user message back into plain text and selection chips. */
export function parseUserTextSegments(text: string): UserTextSegment[] {
  const segments: UserTextSegment[] = [];
  SELECTION_BLOCK_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;

  const pushText = (raw: string) => {
    const trimmed = raw.replace(/^\n+|\n+$/g, "");
    if (trimmed) segments.push({ kind: "text", text: trimmed });
  };

  while ((match = SELECTION_BLOCK_RE.exec(text))) {
    pushText(text.slice(last, match.index));
    segments.push({
      kind: "selection",
      text: unquoteLines(match[2] ?? ""),
      sourcePath: match[1]?.trim() || null,
    });
    last = match.index + match[0].length;
  }
  pushText(text.slice(last));

  return segments;
}

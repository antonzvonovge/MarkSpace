/**
 * Cheap caret-local triggers for `/` slash and `#` tag menus.
 */

import type { EditorState } from "@tiptap/pm/state";
import { TAG_NAME_PATTERN } from "../../lib/hashtagMarkdown";

export type TextTriggerMatch = {
  /** Inclusive start of trigger (`/` or `#`). */
  from: number;
  /** Exclusive end (= caret). */
  to: number;
  query: string;
};

const SLASH_QUERY_RE = /(?:^|[\s([{„"'/\\|])\/([^\s]*)$/;

function textBeforeCaret(state: EditorState): {
  text: string;
  blockStart: number;
  caret: number;
} | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const $from = selection.$from;
  if (!$from.parent.isTextblock) return null;
  if ($from.parent.type.spec.code) return null;
  if ($from.marks().some((m) => m.type.name === "code")) return null;

  const caret = $from.pos;
  const blockStart = $from.start();
  const text = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\ufffc",
  );
  return { text, blockStart, caret };
}

/** `/query` at caret — for Live slash menu. */
export function findSlashTrigger(state: EditorState): TextTriggerMatch | null {
  const before = textBeforeCaret(state);
  if (!before) return null;
  const m = before.text.match(SLASH_QUERY_RE);
  if (!m) return null;
  const query = m[1] ?? "";
  const matched = m[0];
  const slashInMatch = matched.lastIndexOf("/");
  const slashOffsetInText = before.text.length - matched.length + slashInMatch;
  const from = before.blockStart + slashOffsetInText;
  return { from, to: before.caret, query };
}

/**
 * `#query` at caret — for tag suggestions.
 * Opens when `#` itself sits at a legal tag boundary (not mid-word).
 */
export function findTagTrigger(state: EditorState): TextTriggerMatch | null {
  const before = textBeforeCaret(state);
  if (!before) return null;

  const hashIdx = before.text.lastIndexOf("#");
  if (hashIdx < 0) return null;
  const afterHash = before.text.slice(hashIdx + 1);
  if (/\s/.test(afterHash)) return null;
  if (!new RegExp(`^${TAG_NAME_PATTERN}?$`, "u").test(afterHash)) return null;

  if (hashIdx > 0) {
    const prev = before.text[hashIdx - 1] ?? "";
    // Same boundaries as shouldOpenTagMenu / hashtag parser.
    if (!/[\s([{„"'/\\|.,;:!?)`]/.test(prev)) return null;
  }

  const from = before.blockStart + hashIdx;
  return { from, to: before.caret, query: afterHash };
}

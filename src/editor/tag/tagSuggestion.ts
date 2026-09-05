/**
 * Rank vault tags for suggestion menus (TipTap # autocomplete).
 */

import type { EditorState } from "@tiptap/pm/state";
import {
  isValidTagName,
  normalizeInlineTagName,
} from "../../lib/hashtagMarkdown";
import { useVaultStore } from "../../store/vaultStore";

const TAG_SUGGEST_LIMIT = 10;

/** True when `#` at the current selection can start an inline tag. */
export function shouldOpenTagMenu(state: EditorState): boolean {
  const { selection } = state;
  if (!selection.empty) return false;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock) return false;

  if ($from.marks().some((m) => m.type.name === "code")) return false;
  if (parent.type.spec.code) return false;

  const offset = $from.parentOffset;
  if (offset === 0) return true;

  const textBefore = parent.textBetween(0, offset, undefined, "\ufffc");
  const prev = textBefore[textBefore.length - 1] ?? "";
  if (/[\s([{„"'/\\|]/.test(prev)) return true;
  if (/[.,;:!?)]/.test(prev)) return true;
  return false;
}

/** Rank vault tags for the typed query: prefix first, then substring; cap at 10. */
export function rankTagSuggestions(
  vaultTags: string[],
  query: string,
  limit = TAG_SUGGEST_LIMIT,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return vaultTags.slice(0, limit);

  const prefix: string[] = [];
  const rest: string[] = [];
  for (const tag of vaultTags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith(q)) prefix.push(tag);
    else if (lower.includes(q)) rest.push(tag);
  }
  return [...prefix, ...rest].slice(0, limit);
}

export type TagMenuItem = {
  id: string;
  title: string;
  tagName: string;
};

export function getTagMenuItems(query: string): TagMenuItem[] {
  const q = normalizeInlineTagName(query) ?? query.replace(/^#/, "").trim();
  const qLower = q.toLowerCase();
  const vaultTags = useVaultStore.getState().vaultTags;
  const ranked = rankTagSuggestions(vaultTags, q);

  const items: TagMenuItem[] = ranked.map((tag) => ({
    id: `tag:${tag}`,
    title: `#${tag}`,
    tagName: tag,
  }));

  const exact = vaultTags.some((t) => t.toLowerCase() === qLower);
  if (q && isValidTagName(q) && !exact) {
    items.push({
      id: `create:${q}`,
      title: `Create #${q}`,
      tagName: q,
    });
  }

  return items;
}

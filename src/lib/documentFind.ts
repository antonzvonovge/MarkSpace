export type TextRange = { from: number; to: number };

/** Non-overlapping exact substring matches. Empty query → no matches. */
export function findExactMatches(
  text: string,
  query: string,
  matchCase: boolean,
): TextRange[] {
  if (!query) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  if (!needle) return [];
  const out: TextRange[] = [];
  let start = 0;
  while (start <= haystack.length - needle.length) {
    const i = haystack.indexOf(needle, start);
    if (i < 0) break;
    out.push({ from: i, to: i + needle.length });
    start = i + needle.length;
  }
  return out;
}

export function clampFindIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

/**
 * Choose the active match. When `preferCaret` is set, pick the first range at
 * or after `caret`; otherwise keep `previousIndex` if it is still valid.
 */
export function pickFindIndex(
  ranges: TextRange[],
  caret: number,
  previousIndex: number,
  preferCaret: boolean,
): number {
  if (ranges.length === 0) return -1;
  if (!preferCaret && previousIndex >= 0 && previousIndex < ranges.length) {
    return previousIndex;
  }
  const i = ranges.findIndex((r) => r.from >= caret);
  return i >= 0 ? i : 0;
}

type FindWalkNode = {
  isTextblock: boolean;
  isText: boolean;
  text?: string | null;
  descendants: (
    f: (node: FindWalkNode, pos: number) => boolean | void,
  ) => void;
};

/**
 * Search visible text per textblock so marks (bold/italic) do not split a
 * match, while adjacent blocks are not concatenated (`end`+`start`).
 */
export function collectFindRanges(
  doc: FindWalkNode,
  query: string,
  matchCase: boolean,
): TextRange[] {
  if (!query) return [];
  const ranges: TextRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const text: string[] = [];
    const map: number[] = [];
    const endMap: number[] = [];
    node.descendants((child, childPos) => {
      if (child.isTextblock) return false;
      if (!child.isText || !child.text) return;
      const abs = pos + 1 + childPos;
      for (let i = 0; i < child.text.length; i++) {
        map.push(abs + i);
        endMap.push(abs + i + 1);
        text.push(child.text[i]!);
      }
      return false;
    });
    const joined = text.join("");
    for (const m of findExactMatches(joined, query, matchCase)) {
      const from = map[m.from];
      const to = endMap[m.to - 1];
      if (from == null || to == null || from >= to) continue;
      ranges.push({ from, to });
    }
  });
  return ranges;
}

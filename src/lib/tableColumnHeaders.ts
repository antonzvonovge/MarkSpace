/**
 * Detect number / index column headers so the first table column can stay narrow.
 * Exact match after normalize — no cell scanning, O(header length).
 */

const NUMBER_COLUMN_HEADERS = new Set([
  "#",
  "№",
  "n",
  "no",
  "nos",
  "num",
  "number",
  "numbers",
  "номер",
  "ном",
  "п/п",
  "пп",
  "№ п/п",
]);

/** Normalize header text for lookup (trim, lower, collapse spaces, strip one trailing `.`). */
export function normalizeColumnHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
}

/** True when a table's first-column header looks like an index / number column. */
export function isNumberColumnHeader(raw: string): boolean {
  if (!raw) return false;
  const key = normalizeColumnHeader(raw);
  return key.length > 0 && NUMBER_COLUMN_HEADERS.has(key);
}

/**
 * Normalize a tag name to the vault syntax: no leading `#`, no spaces,
 * only letters/digits/`_`/`-`/`/` (spaces become hyphens).
 */
export function sanitizeTagName(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("#")) t = t.slice(1).trim();
  t = t.replace(/[\s_]*[\s]+[\s_]*/gu, "-");
  t = t.replace(/[^\p{L}\p{N}_\-/]+/gu, "-");
  t = t.replace(/-{2,}/g, "-");
  t = t.replace(/\/{2,}/g, "/");
  t = t.replace(/^[-/]+|[-/]+$/g, "");
  return t;
}

/** Sanitize, drop empties, dedupe case-insensitively. */
export function sanitizeTagList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const name = sanitizeTagName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

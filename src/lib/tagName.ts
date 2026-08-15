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

const DIGITS_ONLY_RE = /^\p{N}+$/u;

/** Compact form for catalog matching (`ai_agents` / `ai-agents` → `aiagents`). */
export function compactTagKey(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

/**
 * Map model-suggested tags onto the vault catalog.
 * Catalog hits keep their exact spelling; new tags become lowercase kebab-case.
 */
export function resolveSuggestedTags(
  raw: unknown,
  catalog: string[],
  max = 4,
): string[] {
  if (!Array.isArray(raw) || max <= 0) return [];

  const catalogByLower = new Map<string, string>();
  const catalogByCompact = new Map<string, string>();
  for (const item of catalog) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!catalogByLower.has(lower)) catalogByLower.set(lower, trimmed);
    const compact = compactTagKey(trimmed);
    if (compact && !catalogByCompact.has(compact)) {
      catalogByCompact.set(compact, trimmed);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let name = sanitizeTagName(item);
    if (!name || DIGITS_ONLY_RE.test(name)) continue;

    const fromCatalog =
      catalogByLower.get(name.toLowerCase()) ??
      catalogByLower.get(name.toLowerCase().replace(/_/g, "-")) ??
      catalogByCompact.get(compactTagKey(name));
    if (fromCatalog) {
      name = fromCatalog;
    } else {
      name = name.replace(/_/g, "-").replace(/-{2,}/g, "-").toLowerCase();
      name = name.replace(/^-+|-+$/g, "");
      if (!name || DIGITS_ONLY_RE.test(name)) continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

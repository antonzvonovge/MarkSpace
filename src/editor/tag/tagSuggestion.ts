/**
 * Rank vault tags for suggestion menus (TipTap # autocomplete can reuse this).
 */

const TAG_SUGGEST_LIMIT = 10;

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

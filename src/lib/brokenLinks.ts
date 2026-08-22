import { resolveWikiTarget } from "./vaultApi";
import { isExternalHref, isWikiHref, wikiTargetFromHref } from "./wikiMarkdown";

export const BROKEN_LINK_CLASS = "ms-broken-link";

function vaultTargetFromHref(href: string): string | null {
  if (isExternalHref(href)) return null;
  if (isWikiHref(href)) return wikiTargetFromHref(href);
  const cleaned = href.replace(/^\.\//, "").trim();
  if (!cleaned) return null;
  return cleaned.replace(/\.md$/i, "");
}

/** Mark internal links whose wiki target does not resolve to an existing file. */
export async function decorateBrokenVaultLinks(
  root: HTMLElement,
): Promise<void> {
  const anchors = [...root.querySelectorAll("a[href]")] as HTMLAnchorElement[];
  const cache = new Map<string, boolean>();

  const exists = async (target: string): Promise<boolean> => {
    const key = target.trim();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const resolved = await resolveWikiTarget(key);
    const ok = Boolean(resolved);
    cache.set(key, ok);
    return ok;
  };

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") ?? "";
    const target = vaultTargetFromHref(href);
    if (target == null) {
      anchor.classList.remove(BROKEN_LINK_CLASS);
      continue;
    }
    const ok = await exists(target);
    anchor.classList.toggle(BROKEN_LINK_CLASS, !ok);
  }
}

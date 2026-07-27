/** Convert [[wiki|alias]] into markdown links TipTap understands. */
export function wikiToMarkdown(source: string): string {
  return source.replace(
    /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const trimmed = target.trim();
      const text = (alias ?? trimmed).trim();
      return `[${text}](wiki:${encodeURIComponent(trimmed)})`;
    },
  );
}

/** Convert wiki: links back to [[wiki]] / [[wiki|alias]]. */
export function markdownToWiki(source: string): string {
  return source.replace(
    /\[([^\]]+)\]\(wiki:([^)]+)\)/g,
    (_match, text: string, encoded: string) => {
      const target = decodeURIComponent(encoded);
      if (text === target) {
        return `[[${target}]]`;
      }
      return `[[${target}|${text}]]`;
    },
  );
}

export function isWikiHref(href: string | null | undefined): boolean {
  return Boolean(href?.startsWith("wiki:"));
}

export function wikiTargetFromHref(href: string): string {
  return decodeURIComponent(href.slice("wiki:".length));
}

export function isExternalHref(href: string | null | undefined): boolean {
  if (!href) return false;
  return /^(https?:|mailto:)/i.test(href);
}

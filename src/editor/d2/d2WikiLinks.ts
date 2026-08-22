/** First wiki target inside a D2 quoted label (`[[path|alias]]` or `[alias](wiki:…)`). */
function firstWikiInLabel(text: string): { target: string; display: string } | null {
  const wiki = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(text);
  if (wiki) {
    const target = wiki[1]!.trim();
    const display = (wiki[2] ?? wiki[1]!).trim();
    return { target, display };
  }
  const md = /\[([^\]]+)\]\(wiki:([^)]+)\)/.exec(text);
  if (md) {
    let target = md[2]!.trim();
    try {
      target = decodeURIComponent(target);
    } catch {
      /* keep encoded */
    }
    return { target, display: md[1]!.trim() };
  }
  return null;
}

function stripWikiMarkup(label: string): string {
  return label
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, t: string, a?: string) =>
      (a ?? t).trim(),
    )
    .replace(/\[([^\]]+)\]\(wiki:[^)]+\)/g, (_m, text: string) => text.trim());
}

/**
 * D2 treats `[text](wiki:…)` as literal label text. Lift wiki-links in
 * `id: "…"` assignments onto D2 `link:` so the SVG wraps the shape in `<a>`.
 */
export function rewriteWikiLinksInD2Source(code: string): string {
  return code.replace(
    /^(\s*)([^:\n]+):\s*"((?:\\.|[^"\\])*)"\s*$/gm,
    (full, indent: string, id: string, label: string) => {
      const hit = firstWikiInLabel(label);
      if (!hit) return full;
      const display = stripWikiMarkup(label).replace(/\\"/g, '"');
      const href = `wiki:${encodeURIComponent(hit.target)}`;
      return `${indent}${id}: "${display}" {\n${indent}  link: "${href}"\n${indent}}`;
    },
  );
}

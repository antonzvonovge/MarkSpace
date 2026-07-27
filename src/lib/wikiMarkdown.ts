/** Convert [[wiki|alias]] and ![[drawio|width]] into forms TipTap/BlockNote understand. */
export function wikiToMarkdown(source: string): string {
  // Draw.io file embeds → fenced code (survives BlockNote html↔md; bare <div> does not).
  let next = source.replace(
    /!\[\[([^\]|#]+\.drawio)(?:\|([^\]]+))?\]\]/gi,
    (_match, target: string, width?: string) => {
      const src = target.trim();
      const w = width?.trim() ?? "";
      const body = /^\d+$/.test(w) ? `${src}|${w}` : src;
      return `\`\`\`drawio\n${body}\n\`\`\``;
    },
  );

  return next.replace(
    /\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const trimmed = target.trim();
      const text = (alias ?? trimmed).trim();
      return `[${text}](wiki:${encodeURIComponent(trimmed)})`;
    },
  );
}

/** Convert wiki: links and drawio fences back to [[wiki]] / ![[drawio]]. */
export function markdownToWiki(source: string): string {
  let next = source.replace(
    /```drawio\s*\n([\s\S]*?)```/gi,
    (_match, body: string) => {
      const line = body.trim().split(/\n/)[0]?.trim() ?? "";
      if (!line) return _match;
      const [rawSrc, rawWidth] = line.split("|");
      const src = (rawSrc ?? "").trim();
      if (!/\.drawio$/i.test(src)) return _match;
      const width = (rawWidth ?? "").trim();
      return /^\d+$/.test(width) ? `![[${src}|${width}]]` : `![[${src}]]`;
    },
  );

  // Legacy HTML form from earlier builds.
  next = next.replace(
    /<div\s+([^>]*data-drawio-src="[^"]+"[^>]*)>([\s\S]*?)<\/div>/gi,
    (_match, attrs: string) => {
      const srcMatch = attrs.match(/data-drawio-src="([^"]+)"/i);
      if (!srcMatch) return _match;
      const src = srcMatch[1];
      const widthMatch = attrs.match(/data-preview-width="(\d+)"/i);
      const width = widthMatch?.[1];
      return width ? `![[${src}|${width}]]` : `![[${src}]]`;
    },
  );

  next = next.replace(
    /<div\s+([^>]*data-drawio-src="[^"]+"[^>]*)\s*\/>/gi,
    (_match, attrs: string) => {
      const srcMatch = attrs.match(/data-drawio-src="([^"]+)"/i);
      if (!srcMatch) return _match;
      const src = srcMatch[1];
      const widthMatch = attrs.match(/data-preview-width="(\d+)"/i);
      const width = widthMatch?.[1];
      return width ? `![[${src}|${width}]]` : `![[${src}]]`;
    },
  );

  return next.replace(
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

/** Parse ```drawio fence body → { src, previewWidth }. */
export function parseDrawioFenceBody(body: string): {
  src: string;
  previewWidth?: number;
} | null {
  const line = body.trim().split(/\n/)[0]?.trim() ?? "";
  if (!line) return null;
  const [rawSrc, rawWidth] = line.split("|");
  const src = (rawSrc ?? "").trim();
  if (!src) return null;
  const width = Number((rawWidth ?? "").trim());
  return {
    src,
    previewWidth: Number.isFinite(width) && width > 0 ? width : undefined,
  };
}

export function formatDrawioFenceBody(src: string, previewWidth: number): string {
  return `${src}|${previewWidth}`;
}

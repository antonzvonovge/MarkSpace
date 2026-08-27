/** Convert [[wiki|alias]] and ![[drawio|width]] / ![[audio]] into forms TipTap/BlockNote understand. */
export const AUDIO_WIKI_EMBED_EXT = /\.(?:wav|mp3|m4a|ogg|aac)$/i;

const VAULT_LINK_FILE_EXT =
  String.raw`md|mddict|mdlnks|mdhabit|mdcourse|drawio|pdf|wav|mp3|m4a|ogg|aac`;

/** LLM anti-pattern: `[Note.md](https://Note.md)` — host is a vault filename, not a site. */
function fakeHttpsVaultLinkRe(): RegExp {
  return new RegExp(
    String.raw`\[([^\]]*)\]\(https?:\/\/([^/?#\s)]+\.(?:${VAULT_LINK_FILE_EXT}))\)`,
    "gi",
  );
}

export function isAudioWikiEmbedTarget(target: string): boolean {
  return AUDIO_WIKI_EMBED_EXT.test(target.trim());
}

/**
 * Heal hybrid wiki+markdown vault links that models sometimes emit:
 * - `[[folder/[Note.md](https://Note.md)]]` → `[[folder/Note.md]]`
 * - `[[folder/[Note.md](https://Note.md)|Label]]` → `[[folder/Note.md|Label]]`
 * - `[Note.md](https://Note.md)` → `[[Note.md]]`
 * - `[Label](https://Note.md)` → `[[Note.md|Label]]`
 *
 * Real URLs like `[docs](https://example.com/a.md)` are left alone (path has `/`).
 */
export function healFakeHttpsVaultLinks(text: string): string {
  const unwrapBare = (segment: string) =>
    segment.replace(fakeHttpsVaultLinkRe(), (_m, _label: string, file: string) => file);

  // Inside [[…]] / ![[…]]: unwrap nested markdown so the wiki target is a plain path.
  let next = text.replace(
    /(!?\[\[)([\s\S]*?)(\]\])/g,
    (_m, open: string, body: string, close: string) =>
      `${open}${unwrapBare(body)}${close}`,
  );

  // Standalone fakes → proper wiki-links.
  next = next.replace(
    fakeHttpsVaultLinkRe(),
    (_m, label: string, file: string) => {
      const textLabel = (label ?? "").trim();
      if (
        !textLabel ||
        textLabel === file ||
        textLabel === file.replace(/\.[^.]+$/i, "")
      ) {
        return `[[${file}]]`;
      }
      return `[[${file}|${textLabel}]]`;
    },
  );

  return next;
}

export function wikiToMarkdown(source: string): string {
  // Audio file embeds → fenced code (same trick as Draw.io).
  let next = healFakeHttpsVaultLinks(source).replace(
    /!\[\[([^\]|]+\.(?:wav|mp3|m4a|ogg|aac))(?:\|([^\]]+))?\]\]/gi,
    (_match, target: string) => {
      const src = target.trim();
      return `\`\`\`audio\n${src}\n\`\`\``;
    },
  );

  // Draw.io file embeds → fenced code (survives BlockNote html↔md; bare <div> does not).
  next = next.replace(
    // Allow `#` in paths (e.g. folder `#5 …`); `|` still ends the target.
    /!\[\[([^\]|]+\.drawio)(?:\|([^\]]+))?\]\]/gi,
    (_match, target: string, width?: string) => {
      const src = target.trim();
      const w = width?.trim() ?? "";
      const body = /^\d+$/.test(w) ? `${src}|${w}` : src;
      return `\`\`\`drawio\n${body}\n\`\`\``;
    },
  );

  return next.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_match, target: string, alias?: string) => {
      const trimmed = target.trim();
      const text = (alias ?? trimmed).trim();
      return `[${text}](wiki:${encodeURIComponent(trimmed)})`;
    },
  );
}

/** Convert wiki: links, audio fences, and drawio fences back to [[wiki]] / ![[…]]. */
export function markdownToWiki(source: string): string {
  let next = source.replace(
    /```audio\s*\n([\s\S]*?)```/gi,
    (_match, body: string) => {
      const src = parseAudioFenceBody(body);
      if (!src) return _match;
      return `![[${src}]]`;
    },
  );

  next = next.replace(
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

/** Outgoing `[[target]]` / `[[target|alias]]` (not `![[*.drawio]]` embeds). Skips fenced and inline code. */
export function extractWikiLinkTargets(source: string): string[] {
  const visible = stripMarkdownCodeRegions(source);
  const targets: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(visible))) {
    const at = match.index;
    if (at > 0 && visible[at - 1] === "!") continue;
    const trimmed = match[1].trim();
    if (!trimmed) continue;
    if (/\.drawio$/i.test(trimmed)) continue;
    if (isAudioWikiEmbedTarget(trimmed)) continue;
    targets.push(trimmed);
  }
  return targets;
}

function stripMarkdownCodeRegions(source: string): string {
  let out = "";
  let i = 0;
  const s = source;
  while (i < s.length) {
    if (s.startsWith("```", i)) {
      const end = s.indexOf("```", i + 3);
      if (end === -1) break;
      out += " ".repeat(end + 3 - i);
      i = end + 3;
      continue;
    }
    if (s[i] === "`") {
      const end = s.indexOf("`", i + 1);
      if (end === -1) {
        out += s.slice(i);
        break;
      }
      out += " ".repeat(end + 1 - i);
      i = end + 1;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** Parse ```audio fence body → vault-relative or note-relative path. */
export function parseAudioFenceBody(body: string): string | null {
  const src = body.trim().split(/\n/)[0]?.trim() ?? "";
  if (!src || !isAudioWikiEmbedTarget(src)) return null;
  return src;
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

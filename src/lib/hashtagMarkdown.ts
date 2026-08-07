/**
 * Inline hashtag tags (`#multi-agent`) ↔ BlockNote intermediate HTML.
 *
 * On disk the source of truth is `#name`. For Live editing we project to
 * `<span data-inline-content-type="tag" data-name="…">#…</span>` so the
 * custom inline content node can parse/round-trip.
 */

/** Tag name body after `#`: letters, digits, `_`, `-`, `/` (Unicode letters OK). */
export const TAG_NAME_PATTERN = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_/-]*`;

const TAG_NAME_RE = new RegExp(`^${TAG_NAME_PATTERN}$`, "u");
/** Pure digit sequences (`#5`, `#42`) are not tags — common in folder names like `#5 …`. */
const DIGITS_ONLY_RE = /^\p{N}+$/u;

/** Match a hashtag candidate with a single-char lookbehind consumed in the match. */
const HASHTAG_FIND_RE = new RegExp(
  `(^|[^\\p{L}\\p{N}_/-])#(${TAG_NAME_PATTERN})`,
  "gu",
);

const TAG_SPAN_RE =
  /<span\b([^>]*\bdata-inline-content-type=["']tag["'][^>]*)>([\s\S]*?)<\/span>/gi;

const TAG_SPAN_SELF_RE =
  /<span\b([^>]*\bdata-inline-content-type=["']tag["'][^>]*)\s*\/>/gi;

export function isValidTagName(name: string): boolean {
  return TAG_NAME_RE.test(name) && !DIGITS_ONLY_RE.test(name);
}

export function normalizeInlineTagName(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  if (t.startsWith("#")) t = t.slice(1).trim();
  if (!t || !isValidTagName(t)) return null;
  return t;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Build the Live-editor intermediate span for a tag name. */
export function tagToEditorHtml(name: string): string {
  const safe = escapeHtmlAttr(name);
  return `<span data-inline-content-type="tag" data-name="${safe}">#${safe}</span>`;
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "protect"; text: string };

/**
 * Split markdown into unprotected text vs protected regions (fences, inline
 * code, HTML tags already present, markdown links/images).
 */
function segmentMarkdown(source: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  const n = source.length;

  const pushText = (text: string) => {
    if (!text) return;
    out.push({ kind: "text", text });
  };
  const pushProtect = (text: string) => {
    if (!text) return;
    out.push({ kind: "protect", text });
  };

  while (i < n) {
    // Fenced code block ``` or ~~~
    if (
      (source.startsWith("```", i) || source.startsWith("~~~", i)) &&
      (i === 0 || source[i - 1] === "\n")
    ) {
      const fenceChar = source[i]!;
      const fenceRun = source.slice(i).match(new RegExp(`^${fenceChar}{3,}`))?.[0]
        ?.length;
      if (fenceRun) {
        const openEnd = i + fenceRun;
        const nl = source.indexOf("\n", openEnd);
        const afterInfo = nl === -1 ? n : nl + 1;
        const closeRe = new RegExp(
          `\\n${fenceChar}{${fenceRun},}[ \\t]*(?=\\n|$)`,
        );
        const rest = source.slice(afterInfo);
        const closeMatch = rest.match(closeRe);
        if (closeMatch && closeMatch.index !== undefined) {
          const end = afterInfo + closeMatch.index + closeMatch[0].length;
          pushProtect(source.slice(i, end));
          i = end;
          continue;
        }
        pushProtect(source.slice(i));
        break;
      }
    }

    // Inline code `...`
    if (source[i] === "`") {
      const tickRun = source.slice(i).match(/^`+/)?.[0]?.length ?? 1;
      const close = source.indexOf("`".repeat(tickRun), i + tickRun);
      if (close !== -1) {
        pushProtect(source.slice(i, close + tickRun));
        i = close + tickRun;
        continue;
      }
    }

    // Existing HTML tags (including our tag spans) — protect whole tag.
    if (source[i] === "<") {
      const slice = source.slice(i);
      const tagMatch = slice.match(/^<\/?[A-Za-z][^>]*>/);
      if (tagMatch) {
        pushProtect(tagMatch[0]);
        i += tagMatch[0].length;
        continue;
      }
    }

    // Markdown links / images: [text](url) — protect so # in URLs is safe.
    if (source[i] === "[" || (source[i] === "!" && source[i + 1] === "[")) {
      const start = i;
      if (source[i] === "!") i += 1;
      if (source[i] === "[") {
        const closeBracket = source.indexOf("]", i + 1);
        if (
          closeBracket !== -1 &&
          source[closeBracket + 1] === "(" &&
          source.indexOf(")", closeBracket + 2) !== -1
        ) {
          const closeParen = source.indexOf(")", closeBracket + 2);
          pushProtect(source.slice(start, closeParen + 1));
          i = closeParen + 1;
          continue;
        }
      }
      i = start;
    }

    // Autolinks <https://…#frag>
    if (source[i] === "<" && /^<[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source.slice(i))) {
      const close = source.indexOf(">", i + 1);
      if (close !== -1) {
        pushProtect(source.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }

    // Consume plain text until next special.
    let j = i + 1;
    while (j < n) {
      const c = source[j]!;
      if (
        c === "`" ||
        c === "<" ||
        c === "[" ||
        (c === "!" && source[j + 1] === "[")
      ) {
        break;
      }
      if (
        c === "\n" &&
        (source.startsWith("```", j + 1) || source.startsWith("~~~", j + 1))
      ) {
        j += 1;
        break;
      }
      j += 1;
    }
    pushText(source.slice(i, j));
    i = j;
  }

  return out;
}

function rewriteHashtagsInText(text: string): string {
  // ATX `# Title` / `## H2` and `##foo` do not match TAG_NAME_PATTERN.
  // Pure digits (`#5`) match the pattern but are rejected by isValidTagName.
  return text.replace(HASHTAG_FIND_RE, (_full, prefix: string, name: string) => {
    if (!isValidTagName(name)) return `${prefix}#${name}`;
    return `${prefix}${tagToEditorHtml(name)}`;
  });
}

/**
 * Project on-disk `#tags` into BlockNote HTML intermediate spans.
 * Call after `wikiToMarkdown` so wiki links are already ordinary markdown links.
 */
export function hashtagsToEditorMarkdown(source: string): string {
  return segmentMarkdown(source)
    .map((seg) =>
      seg.kind === "protect" ? seg.text : rewriteHashtagsInText(seg.text),
    )
    .join("");
}

function nameFromTagSpanAttrs(attrs: string): string | null {
  const m = attrs.match(/\bdata-name=["']([^"']*)["']/i);
  if (!m) return null;
  return normalizeInlineTagName(unescapeHtmlAttr(m[1] ?? ""));
}

/**
 * Restore on-disk `#tags` from BlockNote HTML intermediate (and leftover spans).
 * Call before `markdownToWiki`.
 */
export function editorMarkdownToHashtags(source: string): string {
  let next = source.replace(TAG_SPAN_RE, (_match, attrs: string) => {
    const name = nameFromTagSpanAttrs(attrs);
    return name ? `#${name}` : _match;
  });
  next = next.replace(TAG_SPAN_SELF_RE, (_match, attrs: string) => {
    const name = nameFromTagSpanAttrs(attrs);
    return name ? `#${name}` : _match;
  });
  return next;
}

/**
 * Collect unique inline hashtag names from markdown body (not frontmatter).
 * Skips code fences, inline code, links, and existing HTML.
 */
export function extractInlineTags(source: string): string[] {
  const seen = new Map<string, string>();
  for (const seg of segmentMarkdown(source)) {
    if (seg.kind !== "text") continue;
    HASHTAG_FIND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HASHTAG_FIND_RE.exec(seg.text)) !== null) {
      const name = m[2]!;
      if (!isValidTagName(name)) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()];
}

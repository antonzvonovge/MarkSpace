import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: false,
});

function cleanInlineCodeContent(inner: string): string {
  let cleaned = inner.trim();
  cleaned = cleaned.replace(/^\*{1,3}(.+?)\*{1,3}$/s, "$1");
  cleaned = cleaned.replace(/^\*{1,3}(.+?)\*{1,3}/s, "$1");
  cleaned = cleaned.replace(/\*{1,3}(.+?)\*{1,3}$/s, "$1");
  cleaned = cleaned.replace(/\*{1,3}/g, "");
  return cleaned.trim();
}

/** Fix common LLM mistakes before Markdown parse. */
export function normalizeAssistantMarkdown(markdown: string): string {
  return markdown.replace(/`([^`\n]+)`/g, (match, inner: string) => {
    const cleaned = cleanInlineCodeContent(inner);
    return cleaned === inner.trim() ? match : `\`${cleaned}\``;
  });
}

/** Index where an unclosed fenced code block starts, or null. */
function findUnclosedFenceStart(text: string): number | null {
  const lines = text.split("\n");
  let offset = 0;
  let openOffset: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^```/.test(line.trim())) {
      openOffset = openOffset === null ? offset : null;
    }
    offset += line.length + (i < lines.length - 1 ? 1 : 0);
  }

  return openOffset;
}

/**
 * Split streaming Markdown into a stable prefix (safe to parse) and a live tail.
 * The last block after the final blank line stays plain until more arrives.
 */
export function splitStreamingMarkdown(markdown: string): {
  stable: string;
  tail: string;
} {
  if (!markdown) return { stable: "", tail: "" };

  const fenceStart = findUnclosedFenceStart(markdown);
  if (fenceStart !== null) {
    const before = markdown.slice(0, fenceStart).trimEnd();
    const fromFence = markdown.slice(fenceStart);
    if (!before) return { stable: "", tail: fromFence };

    const { stable, tail } = splitLastIncompleteBlock(before);
    return {
      stable,
      tail: tail ? `${tail}\n\n${fromFence}` : fromFence,
    };
  }

  return splitLastIncompleteBlock(markdown);
}

function splitLastIncompleteLine(text: string): { stable: string; tail: string } {
  if (!text) return { stable: "", tail: "" };
  if (text.endsWith("\n")) {
    return { stable: text.trimEnd(), tail: "" };
  }

  const lastBreak = text.lastIndexOf("\n");
  if (lastBreak === -1) return { stable: "", tail: text };

  return {
    stable: text.slice(0, lastBreak),
    tail: text.slice(lastBreak + 1),
  };
}

function splitLastIncompleteBlock(text: string): { stable: string; tail: string } {
  const lastSep = text.lastIndexOf("\n\n");
  if (lastSep === -1) return splitLastIncompleteLine(text);

  const stablePart = text.slice(0, lastSep).trimEnd();
  const tailBlock = text.slice(lastSep + 2);
  const { stable: lineStable, tail } = splitLastIncompleteLine(tailBlock);

  if (!lineStable) {
    return { stable: stablePart, tail: tailBlock };
  }

  return {
    stable: stablePart ? `${stablePart}\n\n${lineStable}` : lineStable,
    tail,
  };
}

export function renderMarkdownToHtml(markdown: string): string {
  const normalized = normalizeAssistantMarkdown(markdown);
  const raw = marked.parse(normalized, { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

export function renderStreamingMarkdownParts(markdown: string): {
  stableHtml: string;
  tail: string;
} {
  const normalized = normalizeAssistantMarkdown(markdown);
  const { stable, tail } = splitStreamingMarkdown(normalized);
  return {
    stableHtml: stable ? renderMarkdownToHtml(stable) : "",
    tail,
  };
}

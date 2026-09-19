/**
 * Split streaming Markdown into a stable prefix (safe to parse) and a live tail.
 * Completed blocks render as markdown; the incomplete trailing block stays plain
 * until more tokens arrive — avoids remark/GFM on every token.
 */

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

/**
 * Split streaming Markdown into a stable prefix (safe to parse) and a live tail.
 * The last incomplete block / line (and any open fence) stays plain until more arrives.
 */
export function splitStreamingMarkdown(markdown: string): {
  stable: string;
  tail: string;
} {
  if (!markdown) return { stable: "", tail: "" };

  const fenceStart = findUnclosedFenceStart(markdown);
  if (fenceStart !== null) {
    // Keep trailing newlines so splitLastIncompleteBlock sees a finished
    // blank-line boundary before the fence (trimEnd would demote "Intro\n\n"
    // to an incomplete "Intro" line).
    const before = markdown.slice(0, fenceStart);
    const fromFence = markdown.slice(fenceStart);
    if (!before.trim()) return { stable: "", tail: fromFence };

    const { stable, tail } = splitLastIncompleteBlock(before);
    return {
      stable,
      tail: tail ? `${tail}\n\n${fromFence}` : fromFence,
    };
  }

  return splitLastIncompleteBlock(markdown);
}

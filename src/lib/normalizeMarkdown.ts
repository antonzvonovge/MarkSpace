/**
 * Normalize note markdown for cross-platform editing.
 *
 * BlockNote's markdown parser splits on `\n` only. On Windows (CRLF) each line
 * keeps a trailing `\r`, which breaks fenced-code detection (`$` / `.` treat
 * `\r` as a line terminator). Fences then become paragraphs with `<br>` and
 * round-trip as markdown hard-breaks (`\` + newline) — visible slashes that
 * also break Mermaid/PlantUML previews.
 *
 * Also heals under-indented list continuations: a flush-left (or shallow)
 * paragraph between two same-level siblings drops out of the list in
 * CommonMark and restarts numbered lists at `1.`.
 */
export function normalizeMarkdown(content: string): string {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return healListContinuations(healFenceHardBreaks(text));
}

/** Strip trailing `\` that CRLF corruption injected onto fence / code lines. */
function healFenceHardBreaks(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;

  for (const line of lines) {
    if (fenceChar === null) {
      const open = line.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/);
      if (open) {
        const [, indent, marker, info] = open;
        fenceChar = marker[0] as "`" | "~";
        fenceLen = marker.length;
        out.push(`${indent}${marker}${info.replace(/\\$/, "")}`);
        continue;
      }
      out.push(line);
      continue;
    }

    const stripped = line.replace(/\\$/, "");
    if (isClosingFence(stripped, fenceChar, fenceLen)) {
      out.push(stripped);
      fenceChar = null;
      fenceLen = 0;
      continue;
    }
    out.push(stripped);
  }

  return out.join("\n");
}

function isClosingFence(
  line: string,
  fenceChar: "`" | "~",
  fenceLen: number,
): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return false;
  if (m[1][0] !== fenceChar || m[1].length < fenceLen) return false;
  return m[2].trim() === "";
}

type ListItemInfo = {
  indent: number;
  textColumn: number;
  ordered: boolean;
};

/**
 * Indent under-indented continuation lines that sit between two same-level
 * list siblings so they stay inside the preceding item. Skips regions that
 * contain a code fence or an ATX heading (those end the list unambiguously).
 * Never decreases indent; never rewrites list markers or fence interiors.
 */
function healListContinuations(text: string): string {
  const lines = text.split("\n");
  const n = lines.length;
  if (n === 0) return text;

  const fenced = markFencedLines(lines);
  const out = lines.slice();
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < n; i++) {
      if (lines[i].trim() === "---") {
        bodyStart = i + 1;
        break;
      }
    }
  }

  for (let i = bodyStart; i < n; i++) {
    if (fenced[i]) continue;
    const item = parseListItem(lines[i]);
    if (!item) continue;

    let sibling = -1;
    let blocked = false;
    for (let j = i + 1; j < n; j++) {
      if (fenced[j]) {
        blocked = true;
        break;
      }
      if (isBlank(lines[j])) continue;
      if (isAtxHeading(lines[j])) {
        blocked = true;
        break;
      }
      const other = parseListItem(lines[j]);
      if (other) {
        if (other.indent > item.indent) continue;
        if (other.indent === item.indent && other.ordered === item.ordered) {
          sibling = j;
        }
        break;
      }
    }
    if (blocked || sibling < 0) continue;

    const pad = " ".repeat(item.textColumn);
    for (let k = i + 1; k < sibling; k++) {
      if (fenced[k] || isBlank(out[k])) continue;
      if (parseListItem(out[k])) continue;
      if (isAtxHeading(out[k])) continue;
      if (hasLeadingTab(out[k])) continue;
      const ind = leadingSpaces(out[k]);
      if (ind < item.textColumn) {
        out[k] = pad + out[k].slice(ind);
      }
    }
  }

  return out.join("\n");
}

function markFencedLines(lines: string[]): boolean[] {
  const fenced = Array.from({ length: lines.length }, () => false);
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fenceChar === null) {
      const open = line.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/);
      if (open) {
        fenceChar = open[2][0] as "`" | "~";
        fenceLen = open[2].length;
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    if (isClosingFence(line.replace(/\\$/, ""), fenceChar, fenceLen)) {
      fenceChar = null;
      fenceLen = 0;
    }
  }
  return fenced;
}

function parseListItem(line: string): ListItemInfo | null {
  const m = line.match(/^([ ]*)([*+-]|\d+\.)([ \t]+)(.*)$/);
  if (!m) return null;
  const indent = m[1].length;
  const marker = m[2];
  // Text column = indent + marker + one space (MarkSpace 2/3-space convention).
  const textColumn = indent + marker.length + 1;
  return {
    indent,
    textColumn,
    ordered: /^\d+\./.test(marker),
  };
}

function leadingSpaces(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

function hasLeadingTab(line: string): boolean {
  return /^\t/.test(line) || /^ +\t/.test(line);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isAtxHeading(line: string): boolean {
  return /^ {0,3}#{1,6}(?:\s|$)/.test(line);
}

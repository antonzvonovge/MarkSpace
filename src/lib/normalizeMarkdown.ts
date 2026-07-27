/**
 * Normalize note markdown for cross-platform editing.
 *
 * BlockNote's markdown parser splits on `\n` only. On Windows (CRLF) each line
 * keeps a trailing `\r`, which breaks fenced-code detection (`$` / `.` treat
 * `\r` as a line terminator). Fences then become paragraphs with `<br>` and
 * round-trip as markdown hard-breaks (`\` + newline) — visible slashes that
 * also break Mermaid/PlantUML previews.
 */
export function normalizeMarkdown(content: string): string {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return healFenceHardBreaks(text);
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

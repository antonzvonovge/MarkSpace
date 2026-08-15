/** Completed checkbox / task-list blocks in Live (BlockNote) and Source markdown. */

export type TaskBlockLike = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  children?: TaskBlockLike[];
};

const COMPLETED_TASK_RE =
  /^([ \t]*)([*+-]|\d+\.)[ \t]+\[[xX]\](?:[ \t].*)?\r?$/;

export function isCompletedCheckListItem(block: TaskBlockLike): boolean {
  if (block.type !== "checkListItem") return false;
  const checked = block.props?.checked;
  return checked === true || checked === "true";
}

/**
 * Outermost completed `checkListItem` ids. Nested children of a completed
 * item are omitted — they are removed with the parent block.
 */
export function collectCompletedTaskIds(
  blocks: readonly TaskBlockLike[],
): string[] {
  const ids: string[] = [];
  const walk = (list: readonly TaskBlockLike[]) => {
    for (const block of list) {
      if (isCompletedCheckListItem(block) && block.id) {
        ids.push(block.id);
        continue;
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(blocks);
  return ids;
}

export type TextRange = {
  from: number;
  to: number;
};

/**
 * Drop completed task-list items (`- [x]`, `* [x]`, `1. [x]`). Nested
 * content (greater indent) of each removed item is dropped with it.
 * Code fences and YAML front-matter are left alone.
 *
 * When `range` is set, only items whose own line overlaps that range are
 * considered (nested body of a hit item is still removed).
 */
export function removeCompletedTaskLines(
  markdown: string,
  range?: TextRange,
): { next: string; removed: number } {
  if (!markdown) return { next: markdown, removed: 0 };

  const lines = markdown.split("\n");
  const starts = lineStartOffsets(markdown, lines);
  const fenced = markFencedLines(lines);
  const keep = Array.from({ length: lines.length }, () => true);
  const bodyStart = frontmatterBodyStart(lines);
  let removed = 0;

  for (let i = bodyStart; i < lines.length; i++) {
    if (!keep[i] || fenced[i]) continue;
    if (!COMPLETED_TASK_RE.test(lines[i]!)) continue;
    if (range && !lineOverlapsRange(starts, lines.length, markdown.length, i, range)) {
      continue;
    }

    const indent = leadingWs(lines[i]!);
    keep[i] = false;
    removed += 1;

    for (let j = i + 1; j < lines.length; j++) {
      if (fenced[j]) break;
      const line = lines[j]!;
      if (line.trim() === "") {
        if (leadingWs(line) > indent) {
          keep[j] = false;
          continue;
        }
        break;
      }
      if (leadingWs(line) > indent) {
        keep[j] = false;
        continue;
      }
      break;
    }
  }

  if (removed === 0) return { next: markdown, removed: 0 };
  return { next: lines.filter((_, i) => keep[i]).join("\n"), removed };
}

function lineStartOffsets(text: string, lines: string[]): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    starts.push(offset);
    offset += lines[i]!.length;
    if (i < lines.length - 1 || text.endsWith("\n")) offset += 1;
  }
  return starts;
}

function lineOverlapsRange(
  starts: number[],
  lineCount: number,
  textLength: number,
  index: number,
  range: TextRange,
): boolean {
  const from = starts[index]!;
  const to = index + 1 < lineCount ? starts[index + 1]! : textLength;
  return from < range.to && to > range.from;
}

function frontmatterBodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === "---") return i + 1;
  }
  return 0;
}

function markFencedLines(lines: string[]): boolean[] {
  const fenced = Array.from({ length: lines.length }, () => false);
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenceChar === null) {
      const open = line.match(/^([ \t]{0,3})(`{3,}|~{3,})(.*)$/);
      if (open) {
        fenceChar = open[2]![0] as "`" | "~";
        fenceLen = open[2]!.length;
        fenced[i] = true;
      }
      continue;
    }
    fenced[i] = true;
    if (isClosingFence(line, fenceChar, fenceLen)) {
      fenceChar = null;
      fenceLen = 0;
    }
  }
  return fenced;
}

function isClosingFence(
  line: string,
  fenceChar: "`" | "~",
  fenceLen: number,
): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return false;
  if (m[1]![0] !== fenceChar || m[1]!.length < fenceLen) return false;
  return m[2]!.trim() === "";
}

function leadingWs(line: string): number {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

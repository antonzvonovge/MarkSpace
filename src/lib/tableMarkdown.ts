/** Table cell color projection for BlockNote ↔ markdown round-trip. */

type BlockLike = {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
};

type TableCellLike = {
  type?: string;
  props?: {
    backgroundColor?: string;
    textColor?: string;
    textAlignment?: string;
    colspan?: number;
    rowspan?: number;
  };
  content?: unknown;
};

/** Depth-first table blocks (same order as BlockNote markdown export). */
export function collectTableBlocks(blocks: BlockLike[]): BlockLike[] {
  const out: BlockLike[] = [];
  for (const block of blocks) {
    if (block.type === "table") out.push(block);
    if (block.children?.length) {
      out.push(...collectTableBlocks(block.children));
    }
  }
  return out;
}

/** True when any cell has a non-default background or text color. */
export function tableHasCellColors(block: BlockLike): boolean {
  const rows = getTableRows(block);
  for (const row of rows) {
    for (const cell of row) {
      const props = normalizeCellProps(cell);
      if (
        (props.backgroundColor && props.backgroundColor !== "default") ||
        (props.textColor && props.textColor !== "default")
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Pull the root `<table>…</table>` from BlockNote HTML export. */
export function extractTableHtml(html: string): string | null {
  const match = html.match(/<table\b[\s\S]*?<\/table>/i);
  return match ? match[0] : null;
}

/**
 * Replace GFM pipe tables with HTML tables when the matching document table
 * has cell colors. `projections[i]` is HTML for the i-th table, or null to
 * leave the GFM table as-is.
 */
export function applyColoredTableHtml(
  markdown: string,
  projections: Array<string | null>,
): string {
  if (projections.every((p) => !p)) return markdown;

  const ranges = findGfmTableRanges(markdown);
  if (ranges.length === 0) return markdown;

  let result = markdown;
  // Replace from the end so earlier offsets stay valid.
  const count = Math.min(ranges.length, projections.length);
  for (let i = count - 1; i >= 0; i--) {
    const html = projections[i];
    if (!html) continue;
    const range = ranges[i];
    if (!range) continue;
    const replacement = html.endsWith("\n") ? html : `${html}\n`;
    result = result.slice(0, range.start) + replacement + result.slice(range.end);
  }

  return result;
}

/** Build per-table projections using the editor's HTML exporter. */
export function projectColoredTables(
  blocks: BlockLike[],
  blocksToHtml: (blocks: BlockLike[]) => string,
): Array<string | null> {
  return collectTableBlocks(blocks).map((block) => {
    if (!tableHasCellColors(block)) return null;
    return extractTableHtml(blocksToHtml([block]));
  });
}

export function findGfmTableRanges(
  markdown: string,
): Array<{ start: number; end: number }> {
  const lines = markdown.split("\n");
  const ranges: Array<{ start: number; end: number }> = [];

  // Precompute line start offsets.
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1; // + '\n' (split drops it; last line may have no trailing nl)
  }

  let i = 0;
  while (i < lines.length - 1) {
    if (isPipeRow(lines[i]!) && isSeparatorRow(lines[i + 1]!)) {
      const start = starts[i]!;
      let j = i + 2;
      while (j < lines.length && isPipeRow(lines[j]!)) j++;
      // End at the start of the line after the table, or EOF.
      // Include trailing newline after the last table row when present.
      const end =
        j < lines.length
          ? starts[j]!
          : markdown.endsWith("\n")
            ? markdown.length
            : markdown.length;
      ranges.push({ start, end });
      i = j;
      continue;
    }
    i++;
  }

  return ranges;
}

function getTableRows(block: BlockLike): TableCellLike[][] {
  const content = block.content as
    | { type?: string; rows?: Array<{ cells?: TableCellLike[] }> }
    | undefined;
  if (!content || content.type !== "tableContent" || !content.rows) return [];
  return content.rows.map((row) => row.cells ?? []);
}

function normalizeCellProps(cell: TableCellLike): {
  backgroundColor?: string;
  textColor?: string;
} {
  // Legacy / partial cells may be bare inline content arrays.
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
    return {};
  }
  if (cell.type === "tableCell" || cell.props) {
    return {
      backgroundColor: cell.props?.backgroundColor,
      textColor: cell.props?.textColor,
    };
  }
  return {};
}

function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  // | --- | :---: | ---: |
  const inner = trimmed.slice(1, -1);
  const cells = inner.split("|");
  if (cells.length === 0) return false;
  return cells.every((cell) => /^\s*:?-{1,}:?\s*$/.test(cell));
}

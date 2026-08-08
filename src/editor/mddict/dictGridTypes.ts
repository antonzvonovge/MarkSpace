import type { MddictItem } from "../../lib/mddictFormat";

export type GridRow = {
  key: string;
  word: string;
  transcript: string;
  translation: string;
  /** Newline-separated examples (one per line). */
  examples: string;
  tags: string[];
  known: boolean;
};

export type ColId =
  | "word"
  | "transcript"
  | "translation"
  | "examples"
  | "tags";

export const COL_IDS: ColId[] = [
  "word",
  "transcript",
  "translation",
  "examples",
  "tags",
];

export const COL_META: Record<
  ColId,
  {
    title: string;
    placeholder: string;
    minWidth: number;
    grow: number;
    maxWidth?: number;
    cellClass: string;
  }
> = {
  word: {
    title: "Word",
    placeholder: "Word",
    minWidth: 140,
    grow: 1.6,
    cellClass: "dict-grid-cell-lg dict-grid-cell-word",
  },
  transcript: {
    title: "Transcript",
    placeholder: "Transcript",
    minWidth: 90,
    grow: 0.85,
    cellClass: "dict-grid-cell-lg dict-grid-cell-transcript",
  },
  translation: {
    title: "Translation",
    placeholder: "Translation",
    minWidth: 100,
    grow: 1,
    cellClass: "dict-grid-cell-translation",
  },
  examples: {
    title: "Examples",
    placeholder: "Examples",
    minWidth: 160,
    grow: 1.8,
    cellClass: "dict-grid-cell-examples",
  },
  tags: {
    title: "Tags",
    placeholder: "Tags",
    minWidth: 160,
    grow: 0.7,
    maxWidth: 280,
    cellClass: "dict-grid-cell-tags",
  },
};

export const HEADER_ROW_HEIGHT = 34;
export const MIN_ROW_HEIGHT = 34;

export function newRowKey(): string {
  return crypto.randomUUID();
}

export function emptyRow(): GridRow {
  return {
    key: newRowKey(),
    word: "",
    transcript: "",
    translation: "",
    examples: "",
    tags: [],
    known: false,
  };
}

export function itemToRow(item: MddictItem, key = newRowKey()): GridRow {
  return {
    key,
    word: item.word,
    transcript: item.transcript,
    translation: item.translation,
    examples: item.examples.join("\n"),
    tags: [...item.tags],
    known: item.known,
  };
}

export function rowToItem(row: GridRow): MddictItem | null {
  const word = row.word.trim();
  if (!word) return null;
  return {
    word,
    transcript: row.transcript.trim(),
    translation: row.translation.trim(),
    examples: row.examples
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    tags: row.tags,
    known: row.known,
  };
}

export function itemsToRows(items: MddictItem[]): GridRow[] {
  return items.map((item) => itemToRow(item));
}

export function rowsToItems(rows: GridRow[]): MddictItem[] {
  const out: MddictItem[] = [];
  for (const row of rows) {
    const item = rowToItem(row);
    if (item) out.push(item);
  }
  return out;
}

/** Always keep at least one blank row in the UI. */
export function ensureRows(rows: GridRow[]): GridRow[] {
  return rows.length === 0 ? [emptyRow()] : rows;
}

export function isRowBlank(row: GridRow): boolean {
  return (
    !row.word.trim() &&
    !row.transcript.trim() &&
    !row.translation.trim() &&
    !row.examples.trim() &&
    row.tags.length === 0
  );
}

/** When auto-add is on, keep a trailing blank row for input. */
export function withTrailingBlank(rows: GridRow[]): GridRow[] {
  const list = ensureRows(rows);
  if (list.length === 0) return [emptyRow()];
  const last = list[list.length - 1]!;
  if (isRowBlank(last)) return list;
  return [...list, emptyRow()];
}

export function copyCellValue(row: GridRow, col: ColId): string {
  if (col === "tags") return row.tags.join(", ");
  return row[col] ?? "";
}

export function pasteCellValue(col: ColId, value: string): Partial<GridRow> {
  const normalized = value.replace(/\r\n/g, "\n");
  if (col === "tags") {
    return {
      tags: normalized
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    };
  }
  return { [col]: normalized } as Partial<GridRow>;
}

export function clearCellValue(col: ColId): Partial<GridRow> {
  if (col === "tags") return { tags: [] };
  return { [col]: "" } as Partial<GridRow>;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  DynamicDataSheetGrid,
  keyColumn,
  type CellProps,
  type Column,
  type DataSheetGridRef,
} from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import {
  AddWordDialog,
  type AddWordDialogValue,
} from "../../components/AppDialog";
import { DocumentToolbar } from "../../components/DocumentToolbar";
import { TagChipsInput } from "../../components/TagChipsInput";
import {
  MDDICT_HEADER,
  collectMddictTags,
  parseMddict,
  serializeMddict,
  type MddictDoc,
  type MddictItem,
} from "../../lib/mddictFormat";
import {
  isNativeLanguageId,
  nativeLanguageLabel,
} from "../../settings/types";
import { useVaultStore } from "../../store/vaultStore";
import { RefreshIcon } from "../../components/treeIcons";
import { DictSheetContextMenu } from "./DictSheetContextMenu";

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

type DictRevealMode = "all" | "translation" | "word";

const REVEAL_MODES: { mode: DictRevealMode; label: string; title: string }[] = [
  { mode: "all", label: "All", title: "Show all columns" },
  {
    mode: "translation",
    label: "Translation",
    title: "Show translation only — recall the word",
  },
  {
    mode: "word",
    label: "Word",
    title: "Show word only — recall the translation",
  },
];

type GridRow = {
  key: string;
  word: string;
  transcript: string;
  translation: string;
  /** Newline-separated examples (one per line). */
  examples: string;
  tags: string[];
};

type TagsColumnData = {
  catalog: string[];
  extraCatalog: string[];
};

type WrapColumnData = {
  placeholder: string;
};

type DictGridNav = {
  /** Move active cell by delta and re-enter edit mode. */
  navigateWhileEditing: (dCol: number, dRow: number) => void;
};

const DictGridNavContext = createContext<DictGridNav | null>(null);

const COL_COUNT = 5;

/**
 * Arrow navigation for single-line editors: ↑↓ move row (unless vertical: false);
 * ←→ move column only at caret start/end.
 */
function handleSingleLineArrowNav(
  e: ReactKeyboardEvent<HTMLElement>,
  nav: DictGridNav | null,
  opts: {
    vertical?: boolean;
    field?: HTMLInputElement | HTMLTextAreaElement;
  } = {},
): boolean {
  if (!nav) return false;
  const vertical = opts.vertical !== false;
  if (
    e.key !== "ArrowUp" &&
    e.key !== "ArrowDown" &&
    e.key !== "ArrowLeft" &&
    e.key !== "ArrowRight"
  ) {
    return false;
  }
  if (vertical && e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    nav.navigateWhileEditing(0, -1);
    return true;
  }
  if (vertical && e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    nav.navigateWhileEditing(0, 1);
    return true;
  }
  const el =
    opts.field ??
    (e.currentTarget instanceof HTMLInputElement ||
    e.currentTarget instanceof HTMLTextAreaElement
      ? e.currentTarget
      : null);
  if (!el) return false;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  if (start !== end) return false;
  if (e.key === "ArrowLeft" && start === 0) {
    e.preventDefault();
    e.stopPropagation();
    nav.navigateWhileEditing(-1, 0);
    return true;
  }
  if (e.key === "ArrowRight" && start === el.value.length) {
    e.preventDefault();
    e.stopPropagation();
    nav.navigateWhileEditing(1, 0);
    return true;
  }
  return false;
}

const HEADER_ROW_HEIGHT = 34;
const ROW_LINE_HEIGHT = 18; // ~13px * 1.35
const ROW_LINE_HEIGHT_LG = 20; // ~15px * 1.35 (transcript)
const ROW_LINE_HEIGHT_WORD = 23; // ~17px * 1.35 (word)
const ROW_LINE_HEIGHT_TAG = 18; // same as body cells (13px * 1.35)
const ROW_PAD = 12;
const MIN_ROW_HEIGHT = 34;

type ColWidths = {
  word: number;
  transcript: number;
  translation: number;
  examples: number;
  tags: number;
};

/** Fallback estimate when the sheet is not laid out yet. */
function countWrappedLines(text: string, charsPerLine: number): number {
  const raw = text.replace(/\r\n/g, "\n");
  if (!raw.trim()) return 1;
  let lines = 0;
  for (const para of raw.split("\n")) {
    const len = Math.max(1, para.length);
    lines += Math.ceil(len / Math.max(6, charsPerLine));
  }
  return Math.max(1, lines);
}

function estimateRowHeight(row: GridRow | null | undefined): number {
  if (!row) return MIN_ROW_HEIGHT;
  const tagsText = (Array.isArray(row.tags) ? row.tags : []).join("  ");
  const contentPx = Math.max(
    countWrappedLines(row.word ?? "", 12) * ROW_LINE_HEIGHT_WORD,
    countWrappedLines(row.transcript ?? "", 10) * ROW_LINE_HEIGHT_LG,
    countWrappedLines(row.translation ?? "", 14) * ROW_LINE_HEIGHT,
    countWrappedLines(row.examples || " ", 36) * ROW_LINE_HEIGHT,
    countWrappedLines(tagsText || " ", 18) * ROW_LINE_HEIGHT_TAG,
  );
  return Math.max(MIN_ROW_HEIGHT, Math.round(ROW_PAD + contentPx));
}

function readColWidths(sheet: HTMLElement | null): ColWidths | null {
  if (!sheet) return null;
  const header = sheet.querySelector(".dsg-row-header");
  if (!header) return null;
  const cells = [...header.querySelectorAll(":scope > .dsg-cell")].filter(
    (el) => !el.classList.contains("dsg-cell-gutter"),
  );
  if (cells.length < 5) return null;
  const rect = (el: Element) => el.getBoundingClientRect().width;
  return {
    word: rect(cells[0]!),
    transcript: rect(cells[1]!),
    translation: rect(cells[2]!),
    examples: rect(cells[3]!),
    tags: rect(cells[4]!),
  };
}

/**
 * Measure row heights with a hidden probe that mirrors cell typography/padding.
 */
function measureRowHeightsDom(
  rows: GridRow[],
  sheet: HTMLElement | null,
): number[] {
  const widths = readColWidths(sheet);
  if (!widths) return rows.map((r) => estimateRowHeight(r));

  const fontFamily =
    (sheet ? getComputedStyle(sheet).fontFamily : "") || "sans-serif";

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:absolute",
    "left:-99999px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "box-sizing:border-box",
    "padding:6px 8px",
    "margin:0",
    "border:0",
    "white-space:pre-wrap",
    "overflow-wrap:anywhere",
    "word-break:break-word",
    "line-height:1.35",
  ].join(";");
  document.body.appendChild(probe);

  const measureText = (text: string, width: number, font: string) => {
    probe.style.display = "block";
    probe.style.flexWrap = "";
    probe.style.gap = "";
    probe.style.width = `${Math.max(40, Math.floor(width))}px`;
    probe.style.font = font;
    probe.replaceChildren();
    probe.textContent = text.trim() ? text : "\u00a0";
    return probe.offsetHeight;
  };

  const measureTags = (tags: string[], width: number) => {
    probe.style.display = "flex";
    probe.style.flexWrap = "wrap";
    probe.style.alignContent = "flex-start";
    probe.style.gap = "4px 10px";
    probe.style.width = `${Math.max(40, Math.floor(width))}px`;
    probe.style.font = `13px / 1.35 ${fontFamily}`;
    probe.replaceChildren();
    if (tags.length === 0) {
      probe.textContent = "\u00a0";
    } else {
      for (const t of tags) {
        const span = document.createElement("span");
        span.textContent = t;
        probe.appendChild(span);
      }
    }
    return probe.offsetHeight;
  };

  try {
    return rows.map((row) => {
      const h = Math.max(
        measureText(row.word, widths.word, `700 17px / 1.35 ${fontFamily}`),
        measureText(
          row.transcript,
          widths.transcript,
          `15px / 1.35 ${fontFamily}`,
        ),
        measureText(
          row.translation,
          widths.translation,
          `13px / 1.35 ${fontFamily}`,
        ),
        measureText(
          row.examples || "\u00a0",
          widths.examples,
          `13px / 1.35 ${fontFamily}`,
        ),
        measureTags(row.tags, widths.tags),
      );
      // +2px for row border/shadow so wrapped glyphs are not clipped.
      return Math.max(MIN_ROW_HEIGHT, h + 2);
    });
  } finally {
    probe.remove();
  }
}

function newRowKey(): string {
  return crypto.randomUUID();
}

function emptyRow(): GridRow {
  return {
    key: newRowKey(),
    word: "",
    transcript: "",
    translation: "",
    examples: "",
    tags: [],
  };
}

function itemToRow(item: MddictItem, key = newRowKey()): GridRow {
  return {
    key,
    word: item.word,
    transcript: item.transcript,
    translation: item.translation,
    examples: item.examples.join("\n"),
    tags: [...item.tags],
  };
}

function rowToItem(row: GridRow): MddictItem | null {
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
  };
}

function itemsToRows(items: MddictItem[]): GridRow[] {
  return items.map((item) => itemToRow(item));
}

function rowsToItems(rows: GridRow[]): MddictItem[] {
  const out: MddictItem[] = [];
  for (const row of rows) {
    const item = rowToItem(row);
    if (item) out.push(item);
  }
  return out;
}

function safeParse(content: string): { doc: MddictDoc; error: string | null } {
  try {
    return { doc: parseMddict(content), error: null };
  } catch (e) {
    return {
      doc: { filter: [], items: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function rowMatchesQuery(row: GridRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.word.toLowerCase().includes(q)) return true;
  if (row.transcript.toLowerCase().includes(q)) return true;
  if (row.translation.toLowerCase().includes(q)) return true;
  if (row.examples.toLowerCase().includes(q)) return true;
  return row.tags.some((t) => t.toLowerCase().includes(q));
}

function rowMatchesFilter(row: GridRow, filter: string[]): boolean {
  if (filter.length === 0) return true;
  const need = filter.map((t) => t.toLowerCase());
  const have = new Set(row.tags.map((t) => t.toLowerCase()));
  return need.every((t) => have.has(t));
}

/** DSG must never receive an empty `value` — its variable-height path crashes. */
function ensureRows(rows: GridRow[]): GridRow[] {
  return rows.length === 0 ? [emptyRow()] : rows;
}

function WrapTextCell({
  rowData,
  setRowData,
  focus,
  active,
  stopEditing,
  columnData,
}: CellProps<string, WrapColumnData>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const nav = useContext(DictGridNavContext);
  const value = rowData ?? "";
  const placeholder = columnData.placeholder;

  useEffect(() => {
    if (!focus || !ref.current) return;
    ref.current.focus();
    ref.current.select();
  }, [focus]);

  if (!focus) {
    return (
      <div className="dict-dsg-wrap-display">
        {value.trim() ? (
          value
        ) : (
          <span className="dict-dsg-placeholder">
            {active ? placeholder : ""}
          </span>
        )}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      className="dict-dsg-wrap-input"
      value={value}
      tabIndex={-1}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => setRowData(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          stopEditing({ nextRow: false });
          return;
        }
        if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          stopEditing({ nextRow: true });
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          stopEditing({ nextRow: false });
          return;
        }
        handleSingleLineArrowNav(e, nav);
      }}
    />
  );
}

function createWrapTextColumn(
  placeholder: string,
): Partial<Column<string, WrapColumnData, string>> {
  return {
    component: WrapTextCell,
    columnData: { placeholder },
    disableKeys: true,
    keepFocus: true,
    deleteValue: () => "",
    copyValue: ({ rowData }) => rowData ?? "",
    pasteValue: ({ value }) => value.replace(/\r\n/g, "\n"),
    isCellEmpty: ({ rowData }) => !(rowData ?? "").trim(),
  };
}

const wordColumn = createWrapTextColumn("Word");
const transcriptColumn = createWrapTextColumn("Transcript");
const translationColumn = createWrapTextColumn("Translation");

function ExamplesCell({
  rowData,
  setRowData,
  focus,
  active,
  stopEditing,
}: CellProps<string, unknown>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = rowData ?? "";

  useEffect(() => {
    if (!focus || !ref.current) return;
    ref.current.focus();
    ref.current.select();
  }, [focus]);

  if (!focus) {
    const lines = value.split("\n").filter((l) => l.trim());
    return (
      <div className="dict-dsg-wrap-display">
        {lines.length === 0 ? (
          <span className="dict-dsg-placeholder">{active ? "Examples" : ""}</span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      className="dict-dsg-wrap-input"
      value={value}
      tabIndex={-1}
      placeholder="One example per line"
      onChange={(e) => setRowData(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          stopEditing({ nextRow: false });
          return;
        }
        if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          stopEditing({ nextRow: true });
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          stopEditing({ nextRow: false });
        }
      }}
    />
  );
}

const examplesColumn: Partial<Column<string, unknown, string>> = {
  component: ExamplesCell,
  disableKeys: true,
  keepFocus: true,
  deleteValue: () => "",
  copyValue: ({ rowData }) => rowData ?? "",
  pasteValue: ({ value }) => value.replace(/\r\n/g, "\n"),
  isCellEmpty: ({ rowData }) => !(rowData ?? "").trim(),
};

function TagsCell({
  rowData,
  setRowData,
  focus,
  active,
  stopEditing,
  columnData,
}: CellProps<string[], TagsColumnData>) {
  const tags = rowData ?? [];
  const nav = useContext(DictGridNavContext);

  if (!focus) {
    return (
      <div className="dict-dsg-tags-display">
        {tags.length === 0 ? (
          <span className="dict-dsg-placeholder">{active ? "Tags" : ""}</span>
        ) : (
          tags.map((t) => (
            <span key={t} className="dict-dsg-tag-chip">
              {t}
            </span>
          ))
        )}
      </div>
    );
  }

  return (
    <div
      className="dict-dsg-tags-edit"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          stopEditing({ nextRow: false });
          return;
        }
        if (
          e.target instanceof HTMLInputElement &&
          handleSingleLineArrowNav(e, nav, {
            vertical: false,
            field: e.target,
          })
        ) {
          return;
        }
      }}
    >
      <TagChipsInput
        tags={tags}
        onChange={setRowData}
        catalog={columnData.catalog}
        extraCatalog={columnData.extraCatalog}
        placeholder="Add tag…"
        ariaLabel="Entry tags"
        className="dict-dsg-tags-input"
        autoFocus
        portalPopover
        onEmptyEnter={() => stopEditing({ nextRow: true })}
      />
    </div>
  );
}

function createTagsColumn(
  catalog: string[],
  extraCatalog: string[],
): Partial<Column<string[], TagsColumnData, string>> {
  return {
    component: TagsCell,
    columnData: { catalog, extraCatalog },
    disableKeys: true,
    keepFocus: true,
    deleteValue: () => [],
    copyValue: ({ rowData }) => (rowData ?? []).join(", "),
    pasteValue: ({ value }) =>
      value
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    isCellEmpty: ({ rowData }) => (rowData ?? []).length === 0,
  };
}

export function DictionaryEditor({ path, content, onChange }: Props) {
  const { doc, error } = useMemo(() => safeParse(content), [content]);
  const dictionaryTags = useVaultStore((s) => s.dictionaryTags);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [revealMode, setRevealMode] = useState<DictRevealMode>("all");
  const [heightNonce, setHeightNonce] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState<number[] | null>(
    null,
  );
  const [rows, setRows] = useState<GridRow[]>(() =>
    ensureRows(itemsToRows(doc.items)),
  );
  const lastEmitted = useRef(content);
  const hasActiveCellRef = useRef(false);
  const gridRef = useRef<DataSheetGridRef>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const heightsRef = useRef<number[]>([]);
  const pendingEditRef = useRef(false);
  const rowCountRef = useRef(0);
  const gridRowsRef = useRef<GridRow[]>([]);

  const projectPath = path.split("/")[0] ?? "";
  const projectProps = projectPropertiesByPath[projectPath];
  const learningLanguageCode =
    projectProps?.projectType === "languageLearning"
      ? (projectProps.learningLanguage ?? "").trim()
      : "";
  const learningLanguageLabel = learningLanguageCode
    ? isNativeLanguageId(learningLanguageCode)
      ? nativeLanguageLabel(learningLanguageCode)
      : learningLanguageCode
    : "";

  useEffect(() => {
    if (content === lastEmitted.current) return;
    lastEmitted.current = content;
    const parsed = safeParse(content);
    if (parsed.error) return;
    setRows(ensureRows(itemsToRows(parsed.doc.items)));
  }, [content]);

  // DSG clears the active cell on Escape when not editing — keep selection instead.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!hasActiveCellRef.current) return;
      const target = e.target;
      const editingInside =
        target instanceof HTMLElement &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT");
      if (editingInside) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const navigateWhileEditing = useCallback((dCol: number, dRow: number) => {
    const grid = gridRef.current;
    const cur = grid?.activeCell;
    if (!grid || !cur) return;
    const nextCol = Math.max(0, Math.min(COL_COUNT - 1, cur.col + dCol));
    const nextRow = Math.max(
      0,
      Math.min(Math.max(0, rowCountRef.current - 1), cur.row + dRow),
    );
    if (nextCol === cur.col && nextRow === cur.row) return;
    pendingEditRef.current = true;
    grid.setActiveCell({ col: nextCol, row: nextRow });
  }, []);

  const gridNav = useMemo(
    () => ({ navigateWhileEditing }),
    [navigateWhileEditing],
  );

  const fileTags = useMemo(() => collectMddictTags(rowsToItems(rows)), [rows]);

  const emitDoc = useCallback(
    (nextDoc: MddictDoc, nextRows: GridRow[]) => {
      setRows(ensureRows(nextRows));
      const text = serializeMddict(nextDoc);
      lastEmitted.current = text;
      onChange(text);
    },
    [onChange],
  );

  const setFilter = (tags: string[]) => {
    emitDoc({ ...doc, filter: tags, items: rowsToItems(rows) }, rows);
  };

  const filtering =
    doc.filter.length > 0 || searchQuery.trim().length > 0;

  const visibleRows = useMemo(() => {
    return rows.filter(
      (row) =>
        rowMatchesFilter(row, doc.filter) && rowMatchesQuery(row, searchQuery),
    );
  }, [rows, doc.filter, searchQuery]);

  const onGridChange = (nextVisible: GridRow[]) => {
    if (!filtering) {
      const next = ensureRows(nextVisible);
      emitDoc({ ...doc, items: rowsToItems(next) }, next);
      return;
    }

    // Patch the full list while a filter/search is active (visible subset only).
    const visibleKeySet = new Set(visibleRows.map((r) => r.key));
    const nextMap = new Map(nextVisible.map((r) => [r.key, r]));
    let nextRows = rows
      .filter((r) => !visibleKeySet.has(r.key) || nextMap.has(r.key))
      .map((r) => nextMap.get(r.key) ?? r);
    for (const row of nextVisible) {
      if (!nextRows.some((r) => r.key === row.key)) {
        nextRows = [...nextRows, row];
      }
    }
    emitDoc({ ...doc, items: rowsToItems(nextRows) }, ensureRows(nextRows));
  };

  const gridRows = filtering ? visibleRows : rows;
  gridRowsRef.current = gridRows;
  rowCountRef.current = gridRows.length;

  const recalculateRowHeights = useCallback(() => {
    const sheet = sheetRef.current;
    const list =
      gridRowsRef.current.length === 0
        ? [emptyRow()]
        : gridRowsRef.current;
    const heights = measureRowHeightsDom(list, sheet);
    heightsRef.current = heights;
    setMeasuredHeights(heights);
    setHeightNonce((n) => n + 1);
  }, []);

  // Remeasure + remount on open / filter / row-count change (may flicker).
  const filterKey = doc.filter.join("\0");
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const list =
          gridRowsRef.current.length === 0
            ? [emptyRow()]
            : gridRowsRef.current;
        const heights = measureRowHeightsDom(list, sheetRef.current);
        heightsRef.current = heights;
        setMeasuredHeights(heights);
        setHeightNonce((n) => n + 1);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [path, gridRows.length, filtering, searchQuery, filterKey]);

  const gridHeight = useMemo(() => {
    const list = gridRows.length === 0 ? [emptyRow()] : gridRows;
    const rowsHeight = list.reduce((sum, row, i) => {
      const measured = measuredHeights?.[i] ?? heightsRef.current[i];
      return sum + (measured ?? estimateRowHeight(row));
    }, 0);
    const extra = filtering ? 0 : gridRows.length === 0 ? 0 : MIN_ROW_HEIGHT;
    return Math.max(
      HEADER_ROW_HEIGHT + MIN_ROW_HEIGHT + 2,
      HEADER_ROW_HEIGHT + rowsHeight + extra + 2,
    );
  }, [filtering, gridRows, measuredHeights, heightNonce]);

  const measureRowHeight = useCallback(
    ({ rowIndex, rowData }: { rowIndex: number; rowData: GridRow }) =>
      heightsRef.current[rowIndex] ??
      measuredHeights?.[rowIndex] ??
      estimateRowHeight(rowData),
    [measuredHeights, heightNonce],
  );

  const onAddWord = (value: AddWordDialogValue) => {
    const wordKey = value.word.trim().toLowerCase();
    const existingIdx = rows.findIndex(
      (r) => r.word.trim().toLowerCase() === wordKey,
    );
    const nextRow: GridRow = {
      key: existingIdx >= 0 ? rows[existingIdx]!.key : newRowKey(),
      word: value.word.trim(),
      transcript: value.transcript,
      translation: value.translation,
      examples: value.examples.join("\n"),
      tags: existingIdx >= 0 ? rows[existingIdx]!.tags : [],
    };
    const nextRows =
      existingIdx >= 0
        ? rows.map((r, i) => (i === existingIdx ? nextRow : r))
        : [...rows, nextRow];
    emitDoc({ ...doc, items: rowsToItems(nextRows) }, nextRows);
    setAddOpen(false);
  };

  const columns = useMemo(() => {
    const tagsCol = createTagsColumn(dictionaryTags, fileTags);
    return [
      {
        ...keyColumn<GridRow, "word">("word", wordColumn),
        title: "Word",
        minWidth: 100,
        grow: 1,
        cellClassName: "dict-dsg-cell-lg dict-dsg-cell-word",
      },
      {
        ...keyColumn<GridRow, "transcript">("transcript", transcriptColumn),
        title: "Transcript",
        minWidth: 90,
        grow: 0.85,
        cellClassName: "dict-dsg-cell-lg dict-dsg-cell-transcript",
      },
      {
        ...keyColumn<GridRow, "translation">("translation", translationColumn),
        title: "Translation",
        minWidth: 100,
        grow: 1,
        cellClassName: "dict-dsg-cell-translation",
      },
      {
        ...keyColumn<GridRow, "examples">("examples", examplesColumn),
        title: "Examples",
        minWidth: 220,
        grow: 2.4,
        cellClassName: "dict-dsg-cell-examples",
      },
      {
        ...keyColumn<GridRow, "tags">("tags", tagsCol),
        title: "Tags",
        minWidth: 160,
        maxWidth: 280,
        grow: 0.7,
        shrink: 1,
        cellClassName: "dict-dsg-cell-tags",
      },
    ];
  }, [dictionaryTags, fileTags]);

  if (error) {
    return (
      <div className="dict-editor-column">
        <DocumentToolbar showOutlineToggle={false} />
        <div className="dict-editor">
          <div className="dict-editor-error">
            <h2>Invalid dictionary file</h2>
            <p>{error}</p>
            <p className="dict-editor-error-hint">
              Switch to Source to fix the file, or recreate it. Expected header:{" "}
              <code>{MDDICT_HEADER}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const dsgVars = {
    "--dsg-selection-border-color": "var(--accent)",
    "--dsg-selection-background-color":
      "color-mix(in srgb, var(--accent) 10%, transparent)",
    "--dsg-header-text-color": "var(--muted)",
    "--dsg-header-active-text-color": "var(--text)",
    "--dsg-border-color": "var(--line)",
    "--dsg-cell-background-color": "var(--editor-surface)",
    "--dsg-cell-disabled-background-color": "var(--editor-surface)",
  } as CSSProperties;

  return (
    <div className="dict-editor-column">
      <DocumentToolbar showOutlineToggle={false} />
      <div className="dict-editor">
        <div className="dict-editor-toolbar">
          <div className="dict-editor-filter">
            <span className="dict-editor-filter-label">Filter</span>
            <TagChipsInput
              tags={doc.filter}
              onChange={setFilter}
              catalog={dictionaryTags}
              extraCatalog={fileTags}
              placeholder="Filter by tag…"
              ariaLabel="Filter tags"
              chipClassName="is-filter-active"
              className="dict-editor-filter-chips"
            />
          </div>
          <div className="dict-editor-search">
            <label className="dict-editor-filter-label" htmlFor="dict-search">
              Search
            </label>
            <input
              id="dict-search"
              type="search"
              className="dict-editor-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find in dictionary…"
              aria-label="Search dictionary"
            />
          </div>
          <div className="dict-editor-toolbar-actions">
            <div
              className="dict-reveal-switch"
              role="radiogroup"
              aria-label="Dictionary reveal mode"
            >
              {REVEAL_MODES.map(({ mode, label, title }) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={revealMode === mode}
                  title={title}
                  className={
                    revealMode === mode
                      ? "dict-reveal-switch-segment is-active"
                      : "dict-reveal-switch-segment"
                  }
                  onClick={() => setRevealMode(mode)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="dict-editor-icon-btn"
              title="Recalculate row heights"
              aria-label="Recalculate row heights"
              onClick={() => recalculateRowHeights()}
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              className="dict-editor-add-btn"
              onClick={() => setAddOpen(true)}
            >
              Add entry
            </button>
          </div>
        </div>

        <AddWordDialog
          open={addOpen}
          learningLanguageCode={learningLanguageCode}
          learningLanguageLabel={learningLanguageLabel}
          onCancel={() => setAddOpen(false)}
          onConfirm={onAddWord}
        />

        {filtering && visibleRows.length === 0 ? (
          <div className="dict-editor-empty">
            <h2>No matches</h2>
            <p>
              {searchQuery.trim()
                ? "No entries match the current search and filters."
                : "No entries have all of the selected filter tags."}
            </p>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => {
                setFilter([]);
                setSearchQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div
            className="dict-editor-sheet"
            ref={sheetRef}
            data-dict-reveal={revealMode}
            style={dsgVars}
          >
            <DictGridNavContext.Provider value={gridNav}>
              <DynamicDataSheetGrid
                key={heightNonce}
                ref={gridRef}
                value={gridRows}
                onChange={onGridChange}
                columns={columns}
                createRow={emptyRow}
                duplicateRow={({ rowData }) => ({
                  ...rowData,
                  key: newRowKey(),
                })}
                height={gridHeight}
                headerRowHeight={HEADER_ROW_HEIGHT}
                rowHeight={measureRowHeight}
                autoAddRow={!filtering}
                addRowsComponent={false}
                gutterColumn={false}
                lockRows={filtering}
                disableExpandSelection
                contextMenuComponent={DictSheetContextMenu}
                onActiveCellChange={({ cell }) => {
                  hasActiveCellRef.current = cell != null;
                  if (!cell || !pendingEditRef.current) return;
                  pendingEditRef.current = false;
                  requestAnimationFrame(() => {
                    document.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "F2",
                        bubbles: true,
                        cancelable: true,
                      }),
                    );
                  });
                }}
              />
            </DictGridNavContext.Provider>
          </div>
        )}
      </div>
    </div>
  );
}

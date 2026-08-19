import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import { TagChipsInput } from "../../components/TagChipsInput";
import { writeClipboardText } from "../../lib/clipboardText";
import { DICT_KNOWN_THRESHOLD } from "../../lib/dictProgress";
import { readTextFromSystemClipboard } from "../pasteImages";
import {
  DictSheetContextMenu,
  type DictContextMenuItem,
} from "./DictSheetContextMenu";
import {
  COL_IDS,
  COL_META,
  HEADER_ROW_HEIGHT,
  clearCellValue,
  copyCellValue,
  emptyRow,
  ensureRows,
  isRowBlank,
  newRowKey,
  pasteCellValue,
  withTrailingBlank,
  type ColId,
  type GridRow,
} from "./dictGridTypes";

export type DictGridProps = {
  rows: GridRow[];
  onChange: (next: GridRow[]) => void;
  lockRows: boolean;
  autoAddRow: boolean;
  tagCatalog: string[];
  tagExtraCatalog: string[];
  notePath?: string;
  /** Lowercase word → correct-answer count from practice sidecar. */
  correctCountByWord?: Record<string, number>;
  onSetKnown?: (row: GridRow, known: boolean) => void;
};

type ActiveCell = { row: number; col: number };

function handleSingleLineArrowNav(
  e: ReactKeyboardEvent<HTMLElement>,
  opts: {
    vertical?: boolean;
    field?: HTMLInputElement | HTMLTextAreaElement;
    onNav: (dCol: number, dRow: number) => void;
  },
): boolean {
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
    opts.onNav(0, -1);
    return true;
  }
  if (vertical && e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    opts.onNav(0, 1);
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
    opts.onNav(-1, 0);
    return true;
  }
  if (e.key === "ArrowRight" && start === el.value.length) {
    e.preventDefault();
    e.stopPropagation();
    opts.onNav(1, 0);
    return true;
  }
  return false;
}

function CellDisplay({
  row,
  col,
  active,
}: {
  row: GridRow;
  col: ColId;
  active: boolean;
}) {
  const meta = COL_META[col];
  if (col === "tags") {
    const tags = row.tags;
    return (
      <div className="dict-grid-tags-display">
        {tags.length === 0 ? (
          <span className="dict-grid-placeholder">
            {active ? meta.placeholder : ""}
          </span>
        ) : (
          tags.map((t) => (
            <span key={t} className="dict-grid-tag-chip">
              {t}
            </span>
          ))
        )}
      </div>
    );
  }
  if (col === "examples") {
    const lines = (row.examples ?? "").split("\n").filter((l) => l.trim());
    return (
      <div className="dict-grid-wrap-display">
        {lines.length === 0 ? (
          <span className="dict-grid-placeholder">
            {active ? meta.placeholder : ""}
          </span>
        ) : (
          lines.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    );
  }
  const value = row[col] ?? "";
  return (
    <div className="dict-grid-wrap-display">
      {value.trim() ? (
        value
      ) : (
        <span className="dict-grid-placeholder">
          {active ? meta.placeholder : ""}
        </span>
      )}
    </div>
  );
}

function CellEditor({
  row,
  col,
  tagCatalog,
  tagExtraCatalog,
  onCommit,
  onCancel,
  onNav,
  onChangeValue,
}: {
  row: GridRow;
  col: ColId;
  tagCatalog: string[];
  tagExtraCatalog: string[];
  onCommit: (nextRow: boolean) => void;
  onCancel: () => void;
  onNav: (dCol: number, dRow: number) => void;
  onChangeValue: (patch: Partial<GridRow>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const value = col === "tags" ? "" : (row[col] ?? "");

  const fitTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, 1)}px`;
  };

  useLayoutEffect(() => {
    if (col === "tags") return;
    fitTextarea();
  }, [col, value]);

  useLayoutEffect(() => {
    if (col === "tags") return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [col]);

  if (col === "tags") {
    return (
      <div
        className="dict-grid-tags-edit"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
            return;
          }
          if (
            e.target instanceof HTMLInputElement &&
            handleSingleLineArrowNav(e, {
              vertical: false,
              field: e.target,
              onNav,
            })
          ) {
            return;
          }
        }}
      >
        <TagChipsInput
          tags={row.tags}
          onChange={(tags) => onChangeValue({ tags })}
          catalog={tagCatalog}
          extraCatalog={tagExtraCatalog}
          placeholder="Add tag…"
          ariaLabel="Entry tags"
          className="dict-grid-tags-input"
          autoFocus
          portalPopover
          onEmptyEnter={() => onCommit(true)}
        />
      </div>
    );
  }

  const placeholder =
    col === "examples" ? "One example per line" : COL_META[col].placeholder;
  const allowArrowNav = col !== "examples";

  return (
    <textarea
      ref={textareaRef}
      className="dict-grid-wrap-input"
      value={value}
      tabIndex={-1}
      placeholder={placeholder}
      rows={1}
      onChange={(e) =>
        onChangeValue({ [col]: e.target.value } as Partial<GridRow>)
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
          return;
        }
        if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          onCommit(true);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          onCommit(false);
          return;
        }
        if (allowArrowNav) {
          handleSingleLineArrowNav(e, { onNav });
        }
      }}
    />
  );
}

function KnownCell({
  row,
  correctCount,
  onToggle,
}: {
  row: GridRow;
  correctCount: number;
  onToggle?: () => void;
}) {
  const blank = isRowBlank(row) && !row.word.trim();
  if (blank) {
    return <div className="dict-grid-known-cell" aria-hidden />;
  }
  const count = row.known
    ? DICT_KNOWN_THRESHOLD
    : Math.min(correctCount, DICT_KNOWN_THRESHOLD);
  const title = row.known
    ? "Known — click to mark as unknown"
    : `Progress ${count}/${DICT_KNOWN_THRESHOLD} — click to mark as known`;
  return (
    <div className="dict-grid-known-cell">
      <button
        type="button"
        className={
          row.known ? "dict-grid-known-btn is-known" : "dict-grid-known-btn"
        }
        title={title}
        aria-label={title}
        aria-pressed={row.known}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle?.();
        }}
      >
        {row.known ? "✓" : count > 0 ? String(count) : "·"}
      </button>
    </div>
  );
}

export function DictGrid({
  rows,
  onChange,
  lockRows,
  autoAddRow,
  tagCatalog,
  tagExtraCatalog,
  notePath,
  correctCountByWord,
  onSetKnown,
}: DictGridProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  usePersistedEditorScroll(scrollEl, notePath ?? "", "live", {
    active: Boolean(notePath),
  });
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{
    clientX: number;
    clientY: number;
    items: DictContextMenuItem[];
  } | null>(null);
  const clipboardRef = useRef("");
  const rowsRef = useRef(rows);
  const activeRef = useRef(active);
  rowsRef.current = rows;
  activeRef.current = active;

  const emitRows = useCallback(
    (next: GridRow[]) => {
      let out = ensureRows(next);
      if (autoAddRow && !lockRows) out = withTrailingBlank(out);
      onChange(out);
    },
    [autoAddRow, lockRows, onChange],
  );

  const updateRow = useCallback(
    (rowIndex: number, patch: Partial<GridRow>) => {
      const list = [...rowsRef.current];
      const cur = list[rowIndex];
      if (!cur) return;
      list[rowIndex] = { ...cur, ...patch };
      emitRows(list);
    },
    [emitRows],
  );

  const focusGrid = () => {
    sheetRef.current?.focus({ preventScroll: true });
  };

  const stopEditing = useCallback(
    (opts: { nextRow?: boolean } = {}) => {
      const cur = activeRef.current;
      setEditing(false);
      if (opts.nextRow && cur) {
        const nextRow = Math.min(cur.row + 1, rowsRef.current.length - 1);
        if (nextRow !== cur.row) {
          setActive({ row: nextRow, col: cur.col });
        }
      }
      requestAnimationFrame(focusGrid);
    },
    [],
  );

  const startEditing = useCallback(
    (cell: ActiveCell, seed?: string) => {
      const row = rowsRef.current[cell.row];
      if (!row) return;
      setActive(cell);
      if (seed != null && COL_IDS[cell.col] !== "tags") {
        const col = COL_IDS[cell.col]!;
        updateRow(cell.row, { [col]: seed } as Partial<GridRow>);
      }
      setEditing(true);
    },
    [updateRow],
  );

  const navigateWhileEditing = useCallback(
    (dCol: number, dRow: number) => {
      const cur = activeRef.current;
      if (!cur) return;
      const nextCol = Math.max(
        0,
        Math.min(COL_IDS.length - 1, cur.col + dCol),
      );
      const nextRow = Math.max(
        0,
        Math.min(Math.max(0, rowsRef.current.length - 1), cur.row + dRow),
      );
      if (nextCol === cur.col && nextRow === cur.row) return;
      setActive({ row: nextRow, col: nextCol });
      setEditing(true);
    },
    [],
  );

  const copyCell = useCallback(async (row: number, col: number) => {
    const r = rowsRef.current[row];
    if (!r) return;
    const text = copyCellValue(r, COL_IDS[col]!);
    clipboardRef.current = text;
    try {
      await writeClipboardText(text);
    } catch {
      /* ignore */
    }
  }, []);

  const applyPasteText = useCallback(
    (row: number, col: number, text: string) => {
      updateRow(row, pasteCellValue(COL_IDS[col]!, text));
    },
    [updateRow],
  );

  const pasteCell = useCallback(
    async (row: number, col: number) => {
      let text = clipboardRef.current;
      try {
        const clip = await readTextFromSystemClipboard();
        if (clip) text = clip;
      } catch {
        /* use internal */
      }
      applyPasteText(row, col, text);
    },
    [applyPasteText],
  );

  const clearCell = useCallback(
    (row: number, col: number) => {
      updateRow(row, clearCellValue(COL_IDS[col]!));
    },
    [updateRow],
  );

  const deleteRowAt = useCallback(
    (rowIndex: number) => {
      if (lockRows) return;
      emitRows(ensureRows(rowsRef.current.filter((_, i) => i !== rowIndex)));
      setActive(null);
      setEditing(false);
    },
    [emitRows, lockRows],
  );

  const insertBelow = useCallback(
    (rowIndex: number) => {
      if (lockRows) return;
      const list = [...rowsRef.current];
      list.splice(rowIndex + 1, 0, emptyRow());
      emitRows(list);
      setActive({ row: rowIndex + 1, col: activeRef.current?.col ?? 0 });
      setEditing(false);
    },
    [emitRows, lockRows],
  );

  const duplicateRowAt = useCallback(
    (rowIndex: number) => {
      if (lockRows) return;
      const src = rowsRef.current[rowIndex];
      if (!src) return;
      const list = [...rowsRef.current];
      list.splice(rowIndex + 1, 0, {
        ...src,
        key: newRowKey(),
        tags: [...src.tags],
        known: false,
      });
      emitRows(list);
      setActive({ row: rowIndex + 1, col: activeRef.current?.col ?? 0 });
      setEditing(false);
    },
    [emitRows, lockRows],
  );

  const onCellContextMenu = (
    e: ReactMouseEvent,
    row: number,
    col: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setActive({ row, col });
    setEditing(false);
    const gridRow = rowsRef.current[row];
    const items: DictContextMenuItem[] = [
      {
        type: "CUT",
        action: () => {
          void copyCell(row, col).then(() => clearCell(row, col));
          setMenu(null);
        },
      },
      {
        type: "COPY",
        action: () => {
          void copyCell(row, col);
          setMenu(null);
        },
      },
      {
        type: "PASTE",
        action: () => {
          void pasteCell(row, col);
          setMenu(null);
        },
      },
    ];
    if (gridRow && gridRow.word.trim() && onSetKnown) {
      if (gridRow.known) {
        items.push({
          type: "MARK_UNKNOWN",
          action: () => {
            onSetKnown(gridRow, false);
            setMenu(null);
          },
        });
      } else {
        items.push({
          type: "MARK_KNOWN",
          action: () => {
            onSetKnown(gridRow, true);
            setMenu(null);
          },
        });
      }
    }
    if (!lockRows) {
      items.push(
        {
          type: "INSERT_ROW_BELOW",
          action: () => {
            insertBelow(row);
            setMenu(null);
          },
        },
        {
          type: "DUPLICATE_ROW",
          action: () => {
            duplicateRowAt(row);
            setMenu(null);
          },
        },
        {
          type: "DELETE_ROW",
          action: () => {
            deleteRowAt(row);
            setMenu(null);
          },
        },
      );
    }
    setMenu({ clientX: e.clientX, clientY: e.clientY, items });
  };

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    if (editing) return;
    if (!active) return;

    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    if (e.key === "F2" || e.key === "Enter") {
      e.preventDefault();
      startEditing(active);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearCell(active.row, active.col);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void copyCell(active.row, active.col);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      e.preventDefault();
      void copyCell(active.row, active.col).then(() =>
        clearCell(active.row, active.col),
      );
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      void pasteCell(active.row, active.col);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive({ row: Math.max(0, active.row - 1), col: active.col });
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive({
        row: Math.min(rows.length - 1, active.row + 1),
        col: active.col,
      });
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActive({ row: active.row, col: Math.max(0, active.col - 1) });
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActive({
        row: active.row,
        col: Math.min(COL_IDS.length - 1, active.col + 1),
      });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const nextCol = e.shiftKey ? active.col - 1 : active.col + 1;
      if (nextCol >= 0 && nextCol < COL_IDS.length) {
        setActive({ row: active.row, col: nextCol });
      }
      return;
    }
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key.length === 1 &&
      COL_IDS[active.col] !== "tags"
    ) {
      e.preventDefault();
      startEditing(active, e.key);
    }
  };

  const onGridPaste = (e: ReactClipboardEvent) => {
    if (editing) return;
    if (!active) return;
    const text = e.clipboardData.getData("text/plain");
    if (text == null) return;
    e.preventDefault();
    clipboardRef.current = text;
    applyPasteText(active.row, active.col, text);
  };

  const displayRows = rows.length === 0 ? [emptyRow()] : rows;

  return (
    <div
      className="dict-grid"
      ref={sheetRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={displayRows.length + 1}
      onKeyDown={onGridKeyDown}
      onPaste={onGridPaste}
      onMouseDown={() => focusGrid()}
    >
      <div
        className="dict-grid-header"
        style={{ height: HEADER_ROW_HEIGHT }}
        role="row"
      >
        <div
          className="dict-grid-cell dict-grid-cell-header dict-grid-cell-known"
          role="columnheader"
          title="Known"
        >
          ✓
        </div>
        {COL_IDS.map((colId) => {
          const meta = COL_META[colId];
          return (
            <div
              key={colId}
              className="dict-grid-cell dict-grid-cell-header"
              role="columnheader"
            >
              {meta.title}
            </div>
          );
        })}
      </div>

      <div className="dict-grid-body" role="rowgroup" ref={setScrollEl}>
        {displayRows.map((row, rowIndex) => {
          const wordKey = row.word.trim().toLowerCase();
          const correctCount =
            wordKey && correctCountByWord
              ? (correctCountByWord[wordKey] ?? 0)
              : 0;
          return (
            <div key={row.key} className="dict-grid-row" role="row">
              <KnownCell
                row={row}
                correctCount={correctCount}
                onToggle={
                  onSetKnown && row.word.trim()
                    ? () => onSetKnown(row, !row.known)
                    : undefined
                }
              />
              {COL_IDS.map((colId, colIndex) => {
                const meta = COL_META[colId];
                const isActive =
                  active?.row === rowIndex && active?.col === colIndex;
                const isEditing = isActive && editing;
                return (
                  <div
                    key={colId}
                    className={
                      "dict-grid-cell " +
                      meta.cellClass +
                      (isActive ? " is-active" : "")
                    }
                    role="gridcell"
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if (isEditing) return;
                      e.preventDefault();
                      setActive({ row: rowIndex, col: colIndex });
                      setEditing(false);
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      startEditing({ row: rowIndex, col: colIndex });
                    }}
                    onContextMenu={(e) =>
                      onCellContextMenu(e, rowIndex, colIndex)
                    }
                  >
                    {isEditing ? (
                      <CellEditor
                        row={row}
                        col={colId}
                        tagCatalog={tagCatalog}
                        tagExtraCatalog={tagExtraCatalog}
                        onChangeValue={(patch) => updateRow(rowIndex, patch)}
                        onCommit={(nextRow) => stopEditing({ nextRow })}
                        onCancel={() => stopEditing()}
                        onNav={navigateWhileEditing}
                      />
                    ) : (
                      <CellDisplay row={row} col={colId} active={isActive} />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {menu ? (
        <DictSheetContextMenu
          clientX={menu.clientX}
          clientY={menu.clientY}
          items={menu.items}
          close={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

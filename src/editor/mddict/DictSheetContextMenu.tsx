import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  ContextMenuComponentProps,
  ContextMenuItem,
} from "react-datasheet-grid";

function itemLabel(item: ContextMenuItem): ReactNode {
  switch (item.type) {
    case "CUT":
      return "Cut";
    case "COPY":
      return "Copy";
    case "PASTE":
      return "Paste";
    case "DELETE_ROW":
      return "Delete row";
    case "DELETE_ROWS":
      return (
        <>
          Delete rows {item.fromRow}–{item.toRow}
        </>
      );
    case "INSERT_ROW_BELLOW":
      return "Insert row below";
    case "DUPLICATE_ROW":
      return "Duplicate row";
    case "DUPLICATE_ROWS":
      return (
        <>
          Duplicate rows {item.fromRow}–{item.toRow}
        </>
      );
  }
}

function isDangerItem(item: ContextMenuItem): boolean {
  return item.type === "DELETE_ROW" || item.type === "DELETE_ROWS";
}

function isClipboardItem(item: ContextMenuItem): boolean {
  return item.type === "CUT" || item.type === "COPY" || item.type === "PASTE";
}

/** Styled like FileTree / EditContextMenu; portaled so DSG overflow does not clip it. */
export function DictSheetContextMenu({
  clientX,
  clientY,
  items,
  close,
}: ContextMenuComponentProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [close]);

  const clipboard = items.filter(isClipboardItem);
  const rowOps = items.filter((item) => !isClipboardItem(item));
  const left = Math.min(clientX, window.innerWidth - 220);
  const top = Math.min(clientY, window.innerHeight - 240);

  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.type}
      type="button"
      role="menuitem"
      className={
        isDangerItem(item)
          ? "tree-context-item is-danger"
          : "tree-context-item"
      }
      onClick={() => {
        // Actions already call setContextMenu(null); do not close() first —
        // unmounting mid-click can race with deleteRows and crash the grid.
        item.action();
      }}
    >
      <span>{itemLabel(item)}</span>
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {clipboard.map(renderItem)}
      {clipboard.length > 0 && rowOps.length > 0 ? (
        <div className="tree-context-sep" role="separator" />
      ) : null}
      {rowOps.map(renderItem)}
    </div>,
    document.body,
  );
}

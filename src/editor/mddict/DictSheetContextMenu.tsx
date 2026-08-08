import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type DictContextMenuItem =
  | { type: "CUT"; action: () => void }
  | { type: "COPY"; action: () => void }
  | { type: "PASTE"; action: () => void }
  | { type: "MARK_KNOWN"; action: () => void }
  | { type: "MARK_UNKNOWN"; action: () => void }
  | { type: "DELETE_ROW"; action: () => void }
  | { type: "INSERT_ROW_BELOW"; action: () => void }
  | { type: "DUPLICATE_ROW"; action: () => void };

function itemLabel(item: DictContextMenuItem): ReactNode {
  switch (item.type) {
    case "CUT":
      return "Cut";
    case "COPY":
      return "Copy";
    case "PASTE":
      return "Paste";
    case "MARK_KNOWN":
      return "Mark as known";
    case "MARK_UNKNOWN":
      return "Mark as unknown";
    case "DELETE_ROW":
      return "Delete row";
    case "INSERT_ROW_BELOW":
      return "Insert row below";
    case "DUPLICATE_ROW":
      return "Duplicate row";
  }
}

function isDangerItem(item: DictContextMenuItem): boolean {
  return item.type === "DELETE_ROW";
}

function isClipboardItem(item: DictContextMenuItem): boolean {
  return item.type === "CUT" || item.type === "COPY" || item.type === "PASTE";
}

function isKnownItem(item: DictContextMenuItem): boolean {
  return item.type === "MARK_KNOWN" || item.type === "MARK_UNKNOWN";
}

type Props = {
  clientX: number;
  clientY: number;
  items: DictContextMenuItem[];
  close: () => void;
};

/** Styled like FileTree / EditContextMenu; portaled so overflow does not clip it. */
export function DictSheetContextMenu({
  clientX,
  clientY,
  items,
  close,
}: Props) {
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
  const knownOps = items.filter(isKnownItem);
  const rowOps = items.filter(
    (item) => !isClipboardItem(item) && !isKnownItem(item),
  );
  const left = Math.min(clientX, window.innerWidth - 220);
  const top = Math.min(clientY, window.innerHeight - 280);

  const renderItem = (item: DictContextMenuItem) => (
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
        item.action();
      }}
    >
      <span>{itemLabel(item)}</span>
    </button>
  );

  const sep = () => <div className="tree-context-sep" role="separator" />;

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {clipboard.map(renderItem)}
      {clipboard.length > 0 && (knownOps.length > 0 || rowOps.length > 0)
        ? sep()
        : null}
      {knownOps.map(renderItem)}
      {knownOps.length > 0 && rowOps.length > 0 ? sep() : null}
      {rowOps.map(renderItem)}
    </div>,
    document.body,
  );
}

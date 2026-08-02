import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type EditContextMenuState = {
  x: number;
  y: number;
  /** When false, Cut is hidden (e.g. chat copy-only menu). */
  showCut?: boolean;
  /** When false, Paste is hidden. */
  showPaste?: boolean;
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
};

type Props = {
  menu: EditContextMenuState;
  onClose: () => void;
  onCut?: () => void;
  onCopy: () => void;
  onPaste?: () => void;
};

export function EditContextMenu({
  menu,
  onClose,
  onCut,
  onCopy,
  onPaste,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const showCut = menu.showCut !== false && onCut != null;
  const showPaste = menu.showPaste !== false && onPaste != null;
  const canCut = menu.canCut !== false;
  const canCopy = menu.canCopy !== false;
  const canPaste = menu.canPaste !== false;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 180);
  const top = Math.min(menu.y, window.innerHeight - 140);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {showCut ? (
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          disabled={!canCut}
          onClick={() => {
            if (!canCut) return;
            onClose();
            onCut();
          }}
        >
          <span>Cut</span>
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        disabled={!canCopy}
        onClick={() => {
          if (!canCopy) return;
          onClose();
          onCopy();
        }}
      >
        <span>Copy</span>
      </button>
      {showPaste ? (
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          disabled={!canPaste}
          onClick={() => {
            if (!canPaste) return;
            onClose();
            onPaste();
          }}
        >
          <span>Paste</span>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

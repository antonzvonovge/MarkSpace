import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  MenuCommentIcon,
  MenuCopyIcon,
  MenuCutIcon,
  MenuPasteIcon,
} from "./menuIcons";

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
  /** When true, show Comment (needs non-empty selection). */
  showComment?: boolean;
  /** When true, show Send to Incoming (needs non-empty selection). */
  showCapture?: boolean;
};

type Props = {
  menu: EditContextMenuState;
  onClose: () => void;
  onCut?: () => void;
  onCopy: () => void;
  onPaste?: () => void;
  onComment?: () => void;
  onCapture?: () => void;
};

export function EditContextMenu({
  menu,
  onClose,
  onCut,
  onCopy,
  onPaste,
  onComment,
  onCapture,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const showCut = menu.showCut !== false && onCut != null;
  const showPaste = menu.showPaste !== false && onPaste != null;
  const showComment = menu.showComment === true && onComment != null;
  const showCapture = menu.showCapture === true && onCapture != null;
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
  const top = Math.min(menu.y, window.innerHeight - 180);

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
          <MenuCutIcon />
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
        <MenuCopyIcon />
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
          <MenuPasteIcon />
          <span>Paste</span>
        </button>
      ) : null}
      {showComment ? (
        <>
          <div className="tree-context-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onComment();
            }}
          >
            <MenuCommentIcon />
            <span>Comment</span>
          </button>
        </>
      ) : null}
      {showCapture ? (
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          onClick={() => {
            onClose();
            onCapture();
          }}
        >
          <MenuInboxIcon />
          <span>Send to Incoming</span>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

function MenuInboxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.25h11v7.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M2.5 4.25 8 8.25l5.5-4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

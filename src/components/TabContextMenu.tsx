import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type TabContextMenuState = {
  x: number;
  y: number;
  /** Stable id of the tab that was right-clicked (editor path or chat thread id). */
  targetId: string;
  /** Index of the tab that was right-clicked. */
  index: number;
  tabCount: number;
  /** Cursor-style sticky pin. */
  pinned?: boolean;
  /** Unpinned tabs besides the clicked one (Close Others / Close Remaining). */
  canCloseOthers?: boolean;
  /** Unpinned tabs to the right of the clicked one. */
  canCloseToTheRight?: boolean;
};

type Props = {
  menu: TabContextMenuState;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseRemaining: () => void;
  onCloseToTheRight: () => void;
  /** When set, shows a “Copy path” item (e.g. chat thread JSON on disk). */
  onCopyPath?: () => void;
  /** When set, shows Pin / Unpin. */
  onTogglePinned?: (pinned: boolean) => void;
};

export function TabContextMenu({
  menu,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseRemaining,
  onCloseToTheRight,
  onCopyPath,
  onTogglePinned,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const hasOthers = menu.canCloseOthers ?? menu.tabCount > 1;
  const hasRemaining = hasOthers;
  const hasToTheRight =
    menu.canCloseToTheRight ?? menu.index < menu.tabCount - 1;
  const showPin = Boolean(onTogglePinned);

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

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 280);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {onCopyPath ? (
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          onClick={() => {
            onClose();
            onCopyPath();
          }}
        >
          <span>Copy path</span>
        </button>
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onCloseTab();
        }}
      >
        <span>Close</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        disabled={!hasOthers}
        onClick={() => {
          if (!hasOthers) return;
          onClose();
          onCloseOthers();
        }}
      >
        <span>Close Others</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        disabled={!hasRemaining}
        onClick={() => {
          if (!hasRemaining) return;
          onClose();
          onCloseRemaining();
        }}
      >
        <span>Close Remaining</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        disabled={!hasToTheRight}
        onClick={() => {
          if (!hasToTheRight) return;
          onClose();
          onCloseToTheRight();
        }}
      >
        <span>Close to the Right</span>
      </button>
      {showPin ? (
        <>
          <div className="tree-context-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onTogglePinned?.(!menu.pinned);
            }}
          >
            <span>{menu.pinned ? "Unpin Tab" : "Pin Tab"}</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

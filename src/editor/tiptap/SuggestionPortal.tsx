/**
 * Lightweight portaled suggestion list for Live slash / tag menus.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { placeAnchoredMenu } from "../../lib/menuPlacement";

export type SuggestionRow = {
  id: string;
  title: string;
  subtext?: string;
  icon?: ReactNode;
  group?: string;
};

type Props = {
  items: SuggestionRow[];
  anchorRect: DOMRect;
  onSelect: (id: string) => void;
  onClose: () => void;
  ariaLabel: string;
  emptyLabel?: string;
  /** Compact rows (tag menu). */
  compact?: boolean;
  className?: string;
  /** Extra key handling while open (e.g. Ctrl+Space palette typing). */
  onKeyDownCapture?: (event: KeyboardEvent) => boolean;
};

export function SuggestionPortal({
  items,
  anchorRect,
  onSelect,
  onClose,
  ariaLabel,
  emptyLabel = "No matching items",
  compact = false,
  className,
  onKeyDownCapture,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onKeyDownCaptureRef = useRef(onKeyDownCapture);
  onKeyDownCaptureRef.current = onKeyDownCapture;
  /** Ignore hover until the pointer actually moves (avoids stealing index 0). */
  const hoverArmedRef = useRef(false);

  const itemsKey = useMemo(
    () => items.map((i) => i.id).join("\0"),
    [items],
  );

  const placed = useMemo(
    () =>
      placeAnchoredMenu(anchorRect, {
        width: compact ? 220 : 280,
        maxHeight: 320,
        prefer: "below",
        gap: 8,
      }),
    [anchorRect, compact],
  );

  useLayoutEffect(() => {
    setSelectedIndex(0);
    hoverArmedRef.current = false;
    const menu = menuRef.current;
    if (menu) {
      menu.focus({ preventScroll: true });
    }
  }, [itemsKey]);

  useEffect(() => {
    if (items.length === 0) return;
    setSelectedIndex((i) => Math.min(i, items.length - 1));
  }, [items.length, itemsKey]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (onKeyDownCaptureRef.current?.(e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      const list = itemsRef.current;
      if (list.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % list.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + list.length) % list.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        const choice = list[selectedIndexRef.current];
        if (choice) onSelectRef.current(choice.id);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    const el = menuRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const style: CSSProperties = {
    position: "fixed",
    left: placed.left,
    width: placed.width,
    maxHeight: placed.maxHeight,
    top: placed.top ?? undefined,
    bottom: placed.bottom ?? undefined,
    zIndex: 1200,
  };

  let currentGroup: string | undefined;
  const rows: ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!compact && item.group && item.group !== currentGroup) {
      currentGroup = item.group;
      rows.push(
        <div
          key={`label-${currentGroup}-${i}`}
          className="bn-suggestion-menu-label"
        >
          {currentGroup}
        </div>,
      );
    }
    const tip = item.subtext ? `${item.title} — ${item.subtext}` : item.title;
    rows.push(
      <button
        key={item.id}
        id={`ms-suggest-${item.id}`}
        type="button"
        role="option"
        data-index={i}
        tabIndex={-1}
        aria-selected={i === selectedIndex}
        className={[
          "bn-suggestion-menu-item",
          compact ? "bn-suggestion-menu-item-small bn-tag-suggestion-item" : "",
          i === selectedIndex ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={tip}
        onMouseEnter={() => {
          if (!hoverArmedRef.current) return;
          setSelectedIndex(i);
        }}
        onClick={() => onSelect(item.id)}
      >
        {item.icon ? (
          <span className="ms-suggest-icon" aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span className="ms-suggest-body">
          <span className="ms-suggest-title">{item.title}</span>
          {!compact && item.subtext ? (
            <span className="ms-suggest-sub">{item.subtext}</span>
          ) : null}
        </span>
      </button>,
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      tabIndex={-1}
      aria-label={ariaLabel}
      aria-activedescendant={
        items[selectedIndex]
          ? `ms-suggest-${items[selectedIndex]!.id}`
          : undefined
      }
      className={[
        "bn-suggestion-menu",
        compact ? "bn-tag-suggestion-menu" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      onPointerMove={() => {
        hoverArmedRef.current = true;
      }}
    >
      {rows.length > 0 ? (
        rows
      ) : (
        <div className="bn-suggestion-menu-item bn-suggestion-menu-item-small">
          {emptyLabel}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Caret client rect for menu anchoring (fallback to editor DOM). */
export function caretClientRect(editorDom: HTMLElement): DOMRect {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    const rect = rects[0];
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  }
  return editorDom.getBoundingClientRect();
}

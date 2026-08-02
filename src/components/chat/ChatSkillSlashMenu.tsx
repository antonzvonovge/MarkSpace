import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type ChatMentionItem = {
  id: string;
  description: string;
};

type Props = {
  items: ChatMentionItem[];
  query: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
  /** Clicks on this element do not dismiss the menu (e.g. the + trigger). */
  excludeCloseRef?: RefObject<HTMLElement | null>;
  /** Shown before the id (`/` for skills, `@` for tools). */
  prefix?: string;
  /** Cap filtered results (e.g. 10 for tools). */
  limit?: number;
  ariaLabel?: string;
  emptyNoItems?: string;
  emptyNoMatch?: string;
};

export function ChatSkillSlashMenu({
  items,
  query,
  onSelect,
  onClose,
  anchorRect,
  excludeCloseRef,
  prefix = "/",
  limit,
  ariaLabel = "Skills",
  emptyNoItems = "No skills yet — create one in Skills/",
  emptyNoMatch = "No matching skills",
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const list = !q
      ? items
      : items.filter(
          (s) =>
            s.id.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        );
    return limit != null ? list.slice(0, limit) : list;
  }, [items, q, limit]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;

  useLayoutEffect(() => {
    setSelectedIndex(0);
  }, [q, items]);

  useEffect(() => {
    if (filtered.length === 0) return;
    setSelectedIndex((i) => Math.min(i, filtered.length - 1));
  }, [filtered.length]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (excludeCloseRef?.current?.contains(t)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        const choice =
          filtered[selectedIndexRef.current] ?? filtered[0];
        if (!choice) return;
        e.preventDefault();
        e.stopPropagation();
        onSelect(choice.id);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [excludeCloseRef, filtered, onClose, onSelect]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const active = menu.querySelector<HTMLElement>(
      ".chat-skill-slash-item.is-active",
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const style: CSSProperties | undefined = anchorRect
    ? {
        left: Math.min(anchorRect.left, window.innerWidth - 320),
        top: Math.max(8, anchorRect.top - 8),
        transform: "translateY(-100%)",
      }
    : undefined;

  return createPortal(
    <div
      ref={menuRef}
      className="chat-skill-slash-menu"
      role="listbox"
      aria-label={ariaLabel}
      style={style}
    >
      {filtered.length === 0 ? (
        <div className="chat-skill-slash-empty">
          {items.length === 0 ? emptyNoItems : emptyNoMatch}
        </div>
      ) : (
        <ul className="chat-skill-slash-list">
          {filtered.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === selectedIndex}
                className={
                  i === selectedIndex
                    ? "chat-skill-slash-item is-active"
                    : "chat-skill-slash-item"
                }
                onMouseEnter={() => setSelectedIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s.id);
                }}
              >
                <span className="chat-skill-slash-id">
                  {prefix}
                  {s.id}
                </span>
                {s.description ? (
                  <span className="chat-skill-slash-desc">{s.description}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}

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

export type ChatSlashFooterAction = {
  id: string;
  label: string;
  description?: string;
  title?: string;
  disabled?: boolean;
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
  /** Extra actions after a separator (plus-button picker only). */
  footerActions?: ChatSlashFooterAction[];
  onFooterSelect?: (id: string) => void;
};

const EMPTY_FOOTER_ACTIONS: ChatSlashFooterAction[] = [];

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
  footerActions,
  onFooterSelect,
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

  const actions = footerActions ?? EMPTY_FOOTER_ACTIONS;
  const navCount = filtered.length + actions.length;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  selectedIndexRef.current = selectedIndex;

  useLayoutEffect(() => {
    setSelectedIndex(0);
  }, [q, items]);

  useEffect(() => {
    if (navCount === 0) return;
    setSelectedIndex((i) => Math.min(i, navCount - 1));
  }, [navCount]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (excludeCloseRef?.current?.contains(t)) return;
      onClose();
    };
    const pick = (index: number) => {
      if (index < filtered.length) {
        const choice = filtered[index];
        if (choice) onSelect(choice.id);
        return;
      }
      const action = actions[index - filtered.length];
      if (!action || action.disabled) return;
      onFooterSelect?.(action.id);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (navCount === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % navCount);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + navCount) % navCount);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        pick(selectedIndexRef.current);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    actions,
    excludeCloseRef,
    filtered,
    navCount,
    onClose,
    onFooterSelect,
    onSelect,
  ]);

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
      {actions.length > 0 ? (
        <>
          <div className="chat-skill-slash-separator" role="separator" />
          <ul className="chat-skill-slash-list">
            {actions.map((action, i) => {
              const index = filtered.length + i;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    disabled={action.disabled}
                    title={action.title}
                    className={
                      index === selectedIndex
                        ? "chat-skill-slash-item chat-skill-slash-action is-active"
                        : "chat-skill-slash-item chat-skill-slash-action"
                    }
                    onMouseEnter={() => setSelectedIndex(index)}
                    onMouseDown={(e) => {
                      if (action.disabled) return;
                      e.preventDefault();
                      onFooterSelect?.(action.id);
                    }}
                  >
                    <span className="chat-skill-slash-id">{action.label}</span>
                    {action.description ? (
                      <span className="chat-skill-slash-desc">
                        {action.description}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

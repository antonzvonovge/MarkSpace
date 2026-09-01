import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchoredMenu } from "../../lib/menuPlacement";

export type TasksComposerPickerOption = {
  value: string;
  label: string;
  color?: string;
};

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

type Props = {
  value: string;
  options: TasksComposerPickerOption[];
  onChange: (value: string) => void;
  /** Visible trigger text (defaults to selected option label). */
  display?: string;
  "aria-label": string;
  /** Show a filter field at the top of the menu (for long list pickers). */
  searchable?: boolean;
  searchPlaceholder?: string;
};

/** Chat-composer-style muted trigger + portaled menu (Project / Agent / Model). */
export function TasksComposerPicker({
  value,
  options,
  onChange,
  display,
  "aria-label": ariaLabel,
  searchable = false,
  searchPlaceholder = "Filter…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = display ?? selected?.label ?? value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeAnchoredMenu(r, {
      gap: 6,
      width: Math.max(r.width, searchable ? 200 : 160),
      maxHeight: 280,
      minHeight: 80,
      prefer: "below",
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
      width: placed.width,
      maxHeight: placed.maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, searchable]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHighlight(0);
      return;
    }
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, searchable]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlight((h) => (h + 1) % filtered.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length === 0) return;
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const choice = filtered[highlight] ?? filtered[0];
      if (choice) pick(choice.value);
    }
  };

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className={
              searchable
                ? "chat-model-menu tasks-composer-picker-menu is-searchable"
                : "chat-model-menu tasks-composer-picker-menu"
            }
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 10000,
            }}
          >
            {searchable ? (
              <div className="tasks-composer-picker-search">
                <input
                  ref={searchRef}
                  type="text"
                  className="tasks-composer-picker-search-input"
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label="Filter lists"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            ) : null}
            <div className="tasks-composer-picker-options">
              {filtered.length > 0 ? (
                filtered.map((opt, index) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={opt.value === value}
                    className={[
                      "chat-model-option",
                      opt.value === value ? "is-active" : "",
                      searchable && index === highlight ? "is-highlight" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pick(opt.value)}
                  >
                    <span className="chat-model-option-main">
                      {opt.color ? (
                        <span
                          className="tasks-composer-picker-dot"
                          style={{ background: opt.color }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="chat-model-option-name">{opt.label}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="tasks-composer-picker-empty">No matches</div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="tasks-composer-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="tasks-composer-ctrl"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tasks-composer-ctrl-label">{label}</span>
      </button>
      {menu}
    </div>
  );
}

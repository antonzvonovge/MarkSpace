import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 280;
const MENU_MIN_HEIGHT = 120;

type Props<T extends string> = {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  tabIndex?: number;
  /** "setting" — compact control in SettingRow; "field" — full-width form field. */
  variant?: "setting" | "field";
  /** Preferred menu direction. `auto` picks the side with more space. */
  menuPlacement?: "auto" | "below" | "above";
  className?: string;
  "aria-label"?: string;
  placeholder?: string;
};

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  tabIndex,
  variant = "setting",
  menuPlacement = "auto",
  className,
  "aria-label": ariaLabel,
  placeholder,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );
  const label = selected?.label ?? placeholder ?? value;

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceAbove = r.top - MENU_GAP;
    const spaceBelow = window.innerHeight - r.bottom - MENU_GAP;
    const up =
      menuPlacement === "above"
        ? true
        : menuPlacement === "below"
          ? false
          : spaceAbove >= MENU_MIN_HEIGHT || spaceAbove >= spaceBelow;
    const width = Math.max(r.width, variant === "setting" ? 140 : r.width);
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: up ? null : r.bottom + MENU_GAP,
      bottom: up ? window.innerHeight - r.top + MENU_GAP : null,
      width,
      maxHeight: Math.max(
        MENU_MIN_HEIGHT,
        Math.min(MENU_MAX_HEIGHT, (up ? spaceAbove : spaceBelow) - 8),
      ),
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open, variant, menuPlacement]);

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

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="ms-select-menu"
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
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={
                  opt.value === value
                    ? "ms-select-option is-active"
                    : "ms-select-option"
                }
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="ms-select-option-label">{opt.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  const rootClass = [
    "ms-select",
    variant === "field" ? "is-field" : "is-setting",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClass} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ms-select-trigger"
        disabled={disabled}
        tabIndex={tabIndex}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ms-select-trigger-label">{label}</span>
        <span className="ms-select-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}

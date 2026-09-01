import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import {
  PROJECT_COLOR_SWATCHES,
  type ProjectColorSwatch,
} from "../../lib/projectColors";

export type ColorSelectOption = {
  value: string;
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

function swatchForHex(hex: string): ProjectColorSwatch | null {
  if (!hex) return null;
  return (
    PROJECT_COLOR_SWATCHES.find(
      (s) => s.hex.toLowerCase() === hex.toLowerCase(),
    ) ?? null
  );
}

function ColorDot({ hex, className }: { hex: string; className?: string }) {
  if (!hex) {
    return (
      <span
        className={["color-select-dot is-none", className].filter(Boolean).join(" ")}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={["color-select-dot", className].filter(Boolean).join(" ")}
      style={{ background: hex }}
      aria-hidden="true"
    />
  );
}

type Props = {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  variant?: "setting" | "field";
  "aria-label"?: string;
  className?: string;
};

/** Compact Material color picker — trigger shows current swatch + label; menu lists presets. */
export function ColorSelect({
  value,
  onChange,
  disabled,
  variant = "field",
  "aria-label": ariaLabel = "Color",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const options = useMemo<ColorSelectOption[]>(
    () => [
      { value: "", label: "None" },
      ...PROJECT_COLOR_SWATCHES.map((s) => ({
        value: s.hex,
        label: s.label,
      })),
    ],
    [],
  );

  const selected = swatchForHex(value);
  const label = selected?.label ?? (value ? "Custom" : "None");

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, variant === "setting" ? 140 : r.width);
    const placed = placeAnchoredMenu(r, {
      gap: MENU_GAP,
      width,
      maxHeight: MENU_MAX_HEIGHT,
      minHeight: MENU_MIN_HEIGHT,
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
  }, [open, variant]);

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
            className="ms-select-menu color-select-menu"
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
                key={opt.value || "__none__"}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={
                  opt.value === value
                    ? "ms-select-option color-select-option is-active"
                    : "ms-select-option color-select-option"
                }
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <ColorDot hex={opt.value} className="color-select-option-dot" />
                <span className="ms-select-option-label">{opt.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  const rootClass = [
    "ms-select",
    "color-select",
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
        className="ms-select-trigger color-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <ColorDot hex={value} className="color-select-trigger-dot" />
        <span className="ms-select-trigger-label">{label}</span>
        <span className="ms-select-trigger-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}

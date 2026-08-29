import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { DEFAULT_ACCENT_HEX, normalizeAccentHex } from "../../lib/accentColor";
import { placeAnchoredMenu } from "../../lib/menuPlacement";

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
};

const MENU_GAP = 6;
const MENU_WIDTH = 228;
const MENU_HEIGHT = 280;

type Props = {
  value: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
  disabled?: boolean;
};

export function RgbPicker({ value, onChange, ariaLabel, disabled }: Props) {
  const hex = normalizeAccentHex(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeAnchoredMenu(r, {
      gap: MENU_GAP,
      width: MENU_WIDTH,
      maxHeight: MENU_HEIGHT,
      minHeight: MENU_HEIGHT,
      prefer: "below",
      align: "end",
    });
    setPos({
      left: placed.left,
      top: placed.top,
      bottom: placed.bottom,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
  }, [open]);

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
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open]);

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="rgb-picker-menu"
            role="dialog"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top ?? undefined,
              bottom: pos.bottom ?? undefined,
              zIndex: 10000,
            }}
          >
            <HexColorPicker
              color={hex}
              onChange={(next) => onChange(normalizeAccentHex(next))}
            />
            <div className="rgb-picker-menu-foot">
              <code className="rgb-picker-hex">{hex}</code>
              {hex !== DEFAULT_ACCENT_HEX && (
                <button
                  type="button"
                  className="rgb-picker-reset"
                  onClick={() => onChange(DEFAULT_ACCENT_HEX)}
                >
                  Reset
                </button>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="rgb-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="rgb-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <span
          className="rgb-picker-swatch"
          style={{ background: hex }}
          aria-hidden
        />
        <code className="rgb-picker-hex">{hex}</code>
        <span className="rgb-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {menu}
    </div>
  );
}

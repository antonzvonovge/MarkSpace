import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatMode } from "../../ai/types";
import { chatComposerAtTop } from "../../lib/chatMenuPlacement";

const MODE_OPTIONS: {
  value: ChatMode;
  label: string;
  description: string;
}[] = [
  { value: "ask", label: "Ask", description: "Read-only" },
  { value: "agent", label: "Agent", description: "Can write notes" },
];

type Props = {
  value: ChatMode;
  disabled?: boolean;
  onChange: (mode: ChatMode) => void;
};

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 220;
const MENU_MIN_HEIGHT = 80;

export function ChatModePicker({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected =
    MODE_OPTIONS.find((o) => o.value === value) ?? MODE_OPTIONS[0];

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceAbove = r.top - MENU_GAP;
    const spaceBelow = window.innerHeight - r.bottom - MENU_GAP;
    // Empty-chat composer is under the tabs — open down into free space.
    const up = chatComposerAtTop(el)
      ? false
      : spaceAbove >= MENU_MIN_HEIGHT || spaceAbove >= spaceBelow;
    const width = Math.max(r.width, 180);
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
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
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
            className="chat-model-menu"
            role="listbox"
            aria-label="Chat mode"
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
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={
                  opt.value === value
                    ? "chat-model-option is-active"
                    : "chat-model-option"
                }
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="chat-model-option-name">{opt.label}</span>
                <span className="chat-model-kind is-chat">
                  {opt.description}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="chat-model-picker chat-mode-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="chat-model-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Chat mode"
        title={`${selected.label} — ${selected.description}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chat-model-trigger-label">{selected.label}</span>
      </button>
      {menu}
    </div>
  );
}

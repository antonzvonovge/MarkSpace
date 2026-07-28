import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { KIND_LABEL, VENDOR_LABEL } from "../../ai/models";
import type { AiModelOption, AiModelVendor } from "../../ai/types";

const VENDOR_ORDER: AiModelVendor[] = ["anthropic", "openai", "google"];

type Props = {
  models: AiModelOption[];
  value: string;
  disabled?: boolean;
  onChange: (modelId: string) => void;
};

function ModelKindBadge({ kind }: { kind: AiModelOption["kind"] }) {
  if (kind === "reasoning") {
    return (
      <em className="chat-model-kind is-reasoning">{KIND_LABEL[kind]}</em>
    );
  }
  return <span className="chat-model-kind is-chat">{KIND_LABEL[kind]}</span>;
}

type MenuPos = { left: number; bottom: number; width: number };

export function ChatModelPicker({ models, value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? null,
    [models, value],
  );

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 240)),
      bottom: window.innerHeight - r.top + 6,
      width: Math.max(r.width, 220),
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
            aria-label="Models"
            style={{
              position: "fixed",
              left: pos.left,
              bottom: pos.bottom,
              width: pos.width,
              zIndex: 10000,
            }}
          >
            {VENDOR_ORDER.map((vendor) => {
              const group = models.filter((m) => m.vendor === vendor);
              if (!group.length) return null;
              return (
                <div key={vendor} className="chat-model-group">
                  <div className="chat-model-group-label">
                    {VENDOR_LABEL[vendor]}
                  </div>
                  {group.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={m.id === value}
                      className={
                        m.id === value
                          ? "chat-model-option is-active"
                          : "chat-model-option"
                      }
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                    >
                      <span className="chat-model-option-name">{m.label}</span>
                      <ModelKindBadge kind={m.kind} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="chat-model-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="chat-model-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
        title={
          selected ? `${selected.label} · ${KIND_LABEL[selected.kind]}` : value
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chat-model-trigger-label">
          {selected?.label ?? value}
        </span>
        {selected ? (
          <>
            <span className="chat-model-trigger-sep" aria-hidden="true">
              ·
            </span>
            <ModelKindBadge kind={selected.kind} />
          </>
        ) : null}
      </button>
      {menu}
    </div>
  );
}

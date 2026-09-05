import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdAutoAwesome } from "react-icons/md";
import { KIND_LABEL, TIER_LABEL, VENDOR_LABEL } from "../../ai/models";
import type { AiModelOption, AiModelVendor } from "../../ai/types";
import { placeChatComposerMenu } from "../../lib/chatMenuPlacement";

const VENDOR_ORDER: AiModelVendor[] = ["openai", "google"];

type Props = {
  models: AiModelOption[];
  value: string;
  disabled?: boolean;
  /** "compact" is the composer toolbar button, "field" is a settings-width input. */
  variant?: "compact" | "field";
  onChange: (modelId: string) => void;
};

function modelDisplayName(model: AiModelOption | null, fallback: string) {
  return model?.label || model?.id || fallback;
}

function ModelKindBadge({ kind }: { kind: AiModelOption["kind"] }) {
  if (kind !== "reasoning") return null;
  const label = KIND_LABEL[kind];
  return (
    <em className="chat-model-kind is-reasoning" title={label} aria-label={label}>
      <MdAutoAwesome size={12} aria-hidden="true" />
    </em>
  );
}

function ModelTierDot({ model }: { model: AiModelOption | null }) {
  if (!model) return null;
  const tier = model.tier ?? "flagship";
  return (
    <span
      className={
        tier === "worker"
          ? "chat-model-tier-dot is-worker"
          : "chat-model-tier-dot is-flagship"
      }
      title={TIER_LABEL[tier]}
      aria-label={TIER_LABEL[tier]}
    />
  );
}

function modelsForVendor(models: AiModelOption[], vendor: AiModelVendor) {
  return models
    .filter((m) => m.vendor === vendor)
    .sort((a, b) => {
      const ta = (a.tier ?? "flagship") === "worker" ? 1 : 0;
      const tb = (b.tier ?? "flagship") === "worker" ? 1 : 0;
      return ta - tb;
    });
}

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 340;
const MENU_MIN_HEIGHT = 160;

export function ChatModelPicker({
  models,
  value,
  disabled,
  variant = "compact",
  onChange,
}: Props) {
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
    const placed = placeChatComposerMenu(r, {
      from: el,
      gap: MENU_GAP,
      width: Math.max(r.width, 220),
      maxHeight: MENU_MAX_HEIGHT,
      minHeight: MENU_MIN_HEIGHT,
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
            className={
              variant === "field"
                ? "chat-model-menu is-field"
                : "chat-model-menu"
            }
            role="listbox"
            aria-label="Models"
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
            {VENDOR_ORDER.map((vendor) => {
              const group = modelsForVendor(models, vendor);
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
                      <span className="chat-model-option-main">
                        <ModelTierDot model={m} />
                        <span className="chat-model-option-name" title={m.id}>
                          {modelDisplayName(m, m.id)}
                        </span>
                      </span>
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

  const isField = variant === "field";

  return (
    <div
      className={isField ? "chat-model-picker is-field" : "chat-model-picker"}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className={isField ? "chat-model-trigger is-field" : "chat-model-trigger"}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Model"
        title={
          selected
            ? `${selected.id} · ${TIER_LABEL[selected.tier ?? "flagship"]}${
                selected.kind === "reasoning"
                  ? ` · ${KIND_LABEL.reasoning}`
                  : ""
              }`
            : value
        }
        onClick={() => setOpen((v) => !v)}
      >
        <ModelTierDot model={selected} />
        <span className="chat-model-trigger-label">
          {modelDisplayName(selected, value)}
        </span>
        {isField ? (
          <span className="chat-model-trigger-caret" aria-hidden="true">
            ▾
          </span>
        ) : null}
      </button>
      {menu}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MdAutoAwesome } from "react-icons/md";
import {
  formatPerMillionPair,
  formatPerMillionTitle,
  lookupModelPrice,
  type ModelPricePerMillion,
} from "../../ai/modelPrices";
import { parseModelRef } from "../../ai/modelRef";
import { KIND_LABEL, TIER_LABEL } from "../../ai/models";
import type { AiModelOption, AiProvider } from "../../ai/types";
import { placeChatComposerMenu } from "../../lib/chatMenuPlacement";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useModelPricesStore } from "../../store/modelPricesStore";

const MENU_MIN_WIDTH = 260;

type ModelTab = "chat" | "specialists";

type Props = {
  models: AiModelOption[];
  value: string;
  disabled?: boolean;
  /** "compact" is the composer toolbar button, "field" is a settings-width input. */
  variant?: "compact" | "field";
  onChange: (modelId: string) => void;
  /**
   * Composer dual picker: Chat / Specialists tabs + link.
   * When set with `onSpecialistChange`, the menu shows both tabs.
   */
  specialistValue?: string;
  specialistsLinked?: boolean;
  onSpecialistChange?: (modelId: string) => void;
  onSpecialistsLinkedChange?: (linked: boolean) => void;
};

type ProviderGroup = {
  key: string;
  label: string;
  disabled: boolean;
  models: AiModelOption[];
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

function ModelPriceMeta({ price }: { price: ModelPricePerMillion }) {
  const label = formatPerMillionPair(price);
  return (
    <span
      className="chat-model-option-price"
      title={formatPerMillionTitle(price)}
      aria-label={formatPerMillionTitle(price)}
    >
      {label}
    </span>
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

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0z"
      />
    </svg>
  );
}

function sortByTier(models: AiModelOption[]): AiModelOption[] {
  return [...models].sort((a, b) => {
    const ta = (a.tier ?? "flagship") === "worker" ? 1 : 0;
    const tb = (b.tier ?? "flagship") === "worker" ? 1 : 0;
    return ta - tb;
  });
}

/** Group catalog models: Auto first, then each provider in settings order. */
export function groupModelsByProvider(
  models: AiModelOption[],
  providers: AiProvider[],
): ProviderGroup[] {
  const byProvider = new Map<string | null, AiModelOption[]>();
  for (const m of models) {
    const { providerId } = parseModelRef(m.id);
    const key = providerId;
    const list = byProvider.get(key) ?? [];
    list.push(m);
    byProvider.set(key, list);
  }

  const groups: ProviderGroup[] = [];
  const auto = byProvider.get(null);
  if (auto?.length) {
    groups.push({
      key: "auto",
      label: "Auto",
      disabled: false,
      models: sortByTier(auto),
    });
  }

  for (const p of providers) {
    const list = byProvider.get(p.id);
    if (!list?.length) continue;
    groups.push({
      key: p.id,
      label: p.enabled ? p.name : `${p.name} (disabled)`,
      disabled: !p.enabled,
      models: sortByTier(list),
    });
    byProvider.delete(p.id);
  }

  // Orphan bindings (provider deleted) still show so the user can switch.
  for (const [pid, list] of byProvider) {
    if (pid == null || !list.length) continue;
    groups.push({
      key: pid,
      label: "Missing provider",
      disabled: true,
      models: sortByTier(list),
    });
  }

  return groups;
}

/** Bare model ids that appear under more than one catalog entry. */
function duplicateBareIds(models: AiModelOption[]): Set<string> {
  const counts = new Map<string, number>();
  for (const m of models) {
    const bare = parseModelRef(m.id).modelId;
    counts.set(bare, (counts.get(bare) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [id, n] of counts) {
    if (n > 1) dups.add(id);
  }
  return dups;
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
  specialistValue,
  specialistsLinked = false,
  onSpecialistChange,
  onSpecialistsLinkedChange,
}: Props) {
  const dual =
    typeof specialistValue === "string" &&
    typeof onSpecialistChange === "function" &&
    typeof onSpecialistsLinkedChange === "function";

  const providers = useAiSettingsStore((s) => s.settings.providers);

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelTab>("chat");
  const [pos, setPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const prices = useModelPricesStore((s) => s.prices);
  const ensureFresh = useModelPricesStore((s) => s.ensureFresh);

  const groups = useMemo(
    () => groupModelsByProvider(models, providers),
    [models, providers],
  );

  const dups = useMemo(() => duplicateBareIds(models), [models]);

  const selected = useMemo(
    () => models.find((m) => m.id === value) ?? null,
    [models, value],
  );

  const activeValue =
    dual && tab === "specialists" && !specialistsLinked
      ? specialistValue!
      : value;

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const placed = placeChatComposerMenu(r, {
      from: el,
      gap: MENU_GAP,
      width: Math.max(r.width, MENU_MIN_WIDTH),
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

  useEffect(() => {
    if (!open) return;
    void ensureFresh();
  }, [open, ensureFresh]);

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

  useEffect(() => {
    if (!open) setTab("chat");
  }, [open]);

  const pickModel = (modelId: string) => {
    if (dual && tab === "specialists" && !specialistsLinked) {
      onSpecialistChange!(modelId);
    } else {
      onChange(modelId);
    }
    setOpen(false);
  };

  const optionLabel = (m: AiModelOption, groupLabel: string) => {
    const bare = parseModelRef(m.id).modelId;
    const base = modelDisplayName(m, m.id);
    if (dups.has(bare) && groupLabel !== "Auto") {
      return `${base} · ${groupLabel.replace(/ \(disabled\)$/, "")}`;
    }
    return base;
  };

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
            {dual ? (
              <div className="chat-model-tabs" role="tablist" aria-label="Model target">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "chat"}
                  className={
                    tab === "chat"
                      ? "chat-model-tab is-active"
                      : "chat-model-tab"
                  }
                  onClick={() => setTab("chat")}
                >
                  Chat
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "specialists"}
                  className={
                    tab === "specialists"
                      ? "chat-model-tab is-active"
                      : "chat-model-tab"
                  }
                  onClick={() => setTab("specialists")}
                >
                  Specialists
                </button>
                <button
                  type="button"
                  className={
                    specialistsLinked
                      ? "chat-model-link is-active"
                      : "chat-model-link"
                  }
                  aria-pressed={specialistsLinked}
                  title={
                    specialistsLinked
                      ? "Specialists use chat model — click to pick separately"
                      : "Link specialists to chat model"
                  }
                  aria-label={
                    specialistsLinked
                      ? "Specialists linked to chat. Click to unlink."
                      : "Link specialists to chat model"
                  }
                  onClick={() => onSpecialistsLinkedChange!(!specialistsLinked)}
                >
                  <LinkIcon />
                </button>
              </div>
            ) : null}
            {dual && tab === "specialists" && specialistsLinked ? (
              <div className="chat-model-linked-hint">
                Using chat model
              </div>
            ) : null}
            {groups.map((group) => {
              const listDisabled =
                (dual && tab === "specialists" && specialistsLinked) ||
                group.disabled;
              return (
                <div key={group.key} className="chat-model-group">
                  <div className="chat-model-group-label">{group.label}</div>
                  {group.models.map((m) => {
                    const price = lookupModelPrice(m.id, prices);
                    const isActive = m.id === activeValue;
                    const name = optionLabel(m, group.label);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        disabled={listDisabled}
                        title={
                          group.disabled
                            ? "Provider disabled — enable it in Settings → API keys"
                            : m.id
                        }
                        className={
                          isActive
                            ? "chat-model-option is-active"
                            : "chat-model-option"
                        }
                        onClick={() => pickModel(m.id)}
                      >
                        <span className="chat-model-option-main">
                          <ModelTierDot model={m} />
                          <span className="chat-model-option-name" title={m.id}>
                            {name}
                          </span>
                        </span>
                        <span className="chat-model-option-price-col">
                          {price ? <ModelPriceMeta price={price} /> : null}
                        </span>
                        <span className="chat-model-option-kind-col">
                          <ModelKindBadge kind={m.kind} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  const isField = variant === "field";
  const triggerName = selected
    ? optionLabel(
        selected,
        (() => {
          const { providerId } = parseModelRef(selected.id);
          if (!providerId) return "Auto";
          return providers.find((p) => p.id === providerId)?.name ?? "Provider";
        })(),
      )
    : modelDisplayName(selected, value);

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
              }${
                dual && specialistsLinked ? " · specialists linked" : ""
              }`
            : value
        }
        onClick={() => setOpen((v) => !v)}
      >
        <ModelTierDot model={selected} />
        <span className="chat-model-trigger-label">{triggerName}</span>
        {dual && specialistsLinked ? (
          <span className="chat-model-trigger-link" aria-hidden="true">
            <LinkIcon />
          </span>
        ) : null}
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

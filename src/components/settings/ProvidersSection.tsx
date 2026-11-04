import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AiProvider } from "../../ai/types";
import { IELTS_KEY_CHIPS } from "../../ai/ieltsFit";
import { getDefaultProvider } from "../../ai/types";
import {
  PROVIDER_PRESETS,
  countModelsForProvider,
  type ProviderPresetId,
} from "../../lib/aiProviders";
import { placeAnchoredMenu } from "../../lib/menuPlacement";
import { verifyOpenAiCredentials } from "../../lib/openAiBaseUrl";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { DialogShell } from "../AppDialog";
import { IeltsKeyChips } from "./IeltsKeyChips";
import { ImportProviderModelsDialog } from "./ImportProviderModelsDialog";

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname || baseUrl;
  } catch {
    return baseUrl || "—";
  }
}

function headersToLines(headers: Record<string, string> | undefined): string {
  if (!headers) return "";
  return Object.entries(headers)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function linesToHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return Object.keys(out).length ? out : undefined;
}

type MenuPos = {
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

function ProviderRowMenu({
  open,
  anchor,
  onClose,
  isDefault,
  enabled,
  onSetDefault,
  onDuplicate,
  onToggleEnabled,
  onDelete,
}: {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  isDefault: boolean;
  enabled: boolean;
  onSetDefault: () => void;
  onDuplicate: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      const placed = placeAnchoredMenu(r, {
        prefer: "below",
        gap: 4,
        width: 180,
        maxHeight: 220,
        align: "end",
      });
      setPos({
        left: placed.left,
        top: placed.top,
        bottom: placed.bottom,
        width: placed.width,
        maxHeight: placed.maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="ms-select-menu provider-row-menu"
      role="menu"
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
      <button
        type="button"
        role="menuitem"
        className="ms-select-option"
        disabled={isDefault}
        onClick={() => {
          onSetDefault();
          onClose();
        }}
      >
        Set as default
      </button>
      <button
        type="button"
        role="menuitem"
        className="ms-select-option"
        onClick={() => {
          onDuplicate();
          onClose();
        }}
      >
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        className="ms-select-option"
        onClick={() => {
          onToggleEnabled();
          onClose();
        }}
      >
        {enabled ? "Disable" : "Enable"}
      </button>
      <button
        type="button"
        role="menuitem"
        className="ms-select-option is-danger"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        Delete…
      </button>
    </div>,
    document.body,
  );
}

function ProviderEditor({
  provider,
  onChange,
  onImport,
}: {
  provider: AiProvider;
  onChange: (next: AiProvider) => void;
  onImport: () => void;
}) {
  const [verifyState, setVerifyState] = useState<
    "idle" | "checking" | "ok" | "error"
  >("idle");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [headersOpen, setHeadersOpen] = useState(false);
  const [headersText, setHeadersText] = useState(() =>
    headersToLines(provider.headers),
  );

  useEffect(() => {
    setHeadersText(headersToLines(provider.headers));
  }, [provider.id, provider.headers]);

  const onVerify = async () => {
    setVerifyState("checking");
    setVerifyMessage("");
    const result = await verifyOpenAiCredentials(
      provider.apiKey,
      provider.baseUrl,
      provider.headers,
    );
    if (result.ok) {
      setVerifyState("ok");
      setVerifyMessage("Connection successful.");
      return;
    }
    setVerifyState("error");
    setVerifyMessage(result.error);
  };

  return (
    <div className="provider-row-editor">
      <label className="provider-field">
        <span className="provider-field-label">Name</span>
        <input
          type="text"
          className="sync-input"
          value={provider.name}
          onChange={(e) => onChange({ ...provider, name: e.target.value })}
          autoComplete="off"
        />
      </label>
      <label className="provider-field">
        <span className="provider-field-label">Base URL</span>
        <input
          type="text"
          className="sync-input"
          value={provider.baseUrl}
          onChange={(e) => {
            setVerifyState("idle");
            onChange({ ...provider, baseUrl: e.target.value });
          }}
          placeholder="https://…"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <label className="provider-field">
        <span className="provider-field-label">API key</span>
        <input
          type="password"
          className="sync-input"
          value={provider.apiKey}
          onChange={(e) => {
            setVerifyState("idle");
            onChange({ ...provider, apiKey: e.target.value });
          }}
          placeholder="sk-… (optional for local servers)"
          autoComplete="off"
        />
      </label>

      <button
        type="button"
        className="provider-headers-toggle"
        onClick={() => setHeadersOpen((v) => !v)}
      >
        {headersOpen ? "Hide extra headers" : "Extra headers…"}
      </button>
      {headersOpen ? (
        <label className="provider-field">
          <span className="provider-field-label">
            Headers (one per line: Name=value)
          </span>
          <textarea
            className="sync-input provider-headers-textarea"
            rows={3}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            onBlur={() =>
              onChange({
                ...provider,
                headers: linesToHeaders(headersText),
              })
            }
            spellCheck={false}
          />
        </label>
      ) : null}

      <div className="sync-actions" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="sync-btn"
          disabled={verifyState === "checking"}
          onClick={() => void onVerify()}
        >
          {verifyState === "checking" ? "Verifying…" : "Verify"}
        </button>
        <button type="button" className="sync-btn" onClick={onImport}>
          Import models…
        </button>
      </div>
      {verifyMessage ? (
        <p
          className="sync-block-desc"
          style={{
            marginTop: 8,
            color: verifyState === "ok" ? "var(--text)" : "var(--danger)",
          }}
        >
          {verifyMessage}
        </p>
      ) : null}
    </div>
  );
}

export function ProvidersSection() {
  const providers = useAiSettingsStore((s) => s.settings.providers);
  const defaultProviderId = useAiSettingsStore(
    (s) => s.settings.defaultProviderId,
  );
  const models = useAiSettingsStore((s) => s.settings.models);
  const upsertProvider = useAiSettingsStore((s) => s.upsertProvider);
  const addProvider = useAiSettingsStore((s) => s.addProvider);
  const setDefaultProvider = useAiSettingsStore((s) => s.setDefaultProvider);
  const setProviderEnabled = useAiSettingsStore((s) => s.setProviderEnabled);
  const deleteProvider = useAiSettingsStore((s) => s.deleteProvider);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [menuForId, setMenuForId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [addMenuPos, setAddMenuPos] = useState<MenuPos | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AiProvider | null>(null);
  const [importTarget, setImportTarget] = useState<AiProvider | null>(null);

  const deleteBoundCount = deleteTarget
    ? countModelsForProvider(models, deleteTarget.id)
    : 0;

  const remapOptions = useMemo(() => {
    if (!deleteTarget) return [];
    return providers.filter((p) => p.id !== deleteTarget.id);
  }, [providers, deleteTarget]);

  const [remapTo, setRemapTo] = useState<string>("");

  useEffect(() => {
    if (!deleteTarget) return;
    setRemapTo(remapOptions[0]?.id ?? "");
  }, [deleteTarget, remapOptions]);

  useEffect(() => {
    if (!addOpen || !addBtnRef.current) return;
    const update = () => {
      const r = addBtnRef.current!.getBoundingClientRect();
      const placed = placeAnchoredMenu(r, {
        prefer: "below",
        gap: 4,
        width: 200,
        maxHeight: 280,
        align: "end",
      });
      setAddMenuPos({
        left: placed.left,
        top: placed.top,
        bottom: placed.bottom,
        width: placed.width,
        maxHeight: placed.maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [addOpen]);

  useEffect(() => {
    if (!addOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (addBtnRef.current?.contains(t)) return;
      const menu = document.getElementById("provider-add-menu");
      if (menu?.contains(t)) return;
      setAddOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addOpen]);

  const onAddPreset = (presetId: ProviderPresetId) => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)!;
    const created = addProvider({
      name: preset.name,
      baseUrl: preset.baseUrl || "http://localhost:4000/v1",
      apiKey: "",
      enabled: true,
    });
    setExpandedId(created.id);
    setAddOpen(false);
  };

  return (
    <section className="sync-block">
      <div className="provider-section-header">
        <div>
          <h3 className="sync-block-title">Providers</h3>
          <p className="sync-block-desc">
            OpenAI-compatible gateways (LiteLLM, OpenRouter, Ollama, …). The
            default provider serves auto-routed catalog models and IELTS OpenAI
            TTS/Whisper. Models can also be bound to a specific provider.
          </p>
        </div>
        <button
          ref={addBtnRef}
          type="button"
          className="sync-btn sync-btn-primary"
          aria-haspopup="menu"
          aria-expanded={addOpen}
          onClick={() => setAddOpen((v) => !v)}
        >
          Add provider
        </button>
      </div>

      {addOpen && addMenuPos
        ? createPortal(
            <div
              id="provider-add-menu"
              className="ms-select-menu"
              role="menu"
              style={{
                position: "fixed",
                left: addMenuPos.left,
                top: addMenuPos.top ?? undefined,
                bottom: addMenuPos.bottom ?? undefined,
                width: addMenuPos.width,
                maxHeight: addMenuPos.maxHeight,
                zIndex: 10000,
              }}
            >
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="ms-select-option"
                  onClick={() => onAddPreset(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}

      {providers.length === 0 ? (
        <p className="sync-block-desc" style={{ marginTop: 8 }}>
          No providers yet. Add LiteLLM, OpenRouter, or another OpenAI-compatible
          proxy.
        </p>
      ) : (
        <ul className="provider-list" aria-label="Providers">
          {providers.map((p) => {
            const isDefault = p.id === defaultProviderId;
            const modelCount = countModelsForProvider(models, p.id);
            const expanded = expandedId === p.id;
            return (
              <li
                key={p.id}
                className={`provider-row${!p.enabled ? " is-disabled" : ""}`}
              >
                <div className="provider-row-summary">
                  <button
                    type="button"
                    className="provider-row-main"
                    onClick={() =>
                      setExpandedId((id) => (id === p.id ? null : p.id))
                    }
                    aria-expanded={expanded}
                  >
                    <span
                      className={`provider-status-dot${p.enabled ? " is-on" : ""}`}
                      aria-hidden="true"
                    />
                    <span className="provider-row-text">
                      <span className="provider-row-name">{p.name}</span>
                      <span className="provider-row-meta">
                        {hostOf(p.baseUrl)}
                        {" · "}
                        {modelCount} model{modelCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    {isDefault ? (
                      <span className="ai-models-catalog-badge">Default</span>
                    ) : null}
                    {!p.enabled ? (
                      <span className="ai-models-catalog-badge">Disabled</span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="provider-row-more"
                    aria-label={`Actions for ${p.name}`}
                    onClick={(e) => {
                      setMenuForId(p.id);
                      setMenuAnchor(e.currentTarget);
                    }}
                  >
                    ⋯
                  </button>
                </div>
                {expanded ? (
                  <ProviderEditor
                    provider={p}
                    onChange={(next) => upsertProvider(next)}
                    onImport={() => setImportTarget(p)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ProviderRowMenu
        open={menuForId != null}
        anchor={menuAnchor}
        onClose={() => {
          setMenuForId(null);
          setMenuAnchor(null);
        }}
        isDefault={menuForId === defaultProviderId}
        enabled={
          providers.find((p) => p.id === menuForId)?.enabled !== false
        }
        onSetDefault={() => {
          if (menuForId) setDefaultProvider(menuForId);
        }}
        onDuplicate={() => {
          const src = providers.find((p) => p.id === menuForId);
          if (!src) return;
          const copy = addProvider({
            name: `${src.name} copy`,
            baseUrl: src.baseUrl,
            apiKey: src.apiKey,
            enabled: src.enabled,
            headers: src.headers,
          });
          setExpandedId(copy.id);
        }}
        onToggleEnabled={() => {
          const src = providers.find((p) => p.id === menuForId);
          if (!src) return;
          setProviderEnabled(src.id, !src.enabled);
        }}
        onDelete={() => {
          const src = providers.find((p) => p.id === menuForId);
          if (src) setDeleteTarget(src);
        }}
      />

      <DialogShell
        open={deleteTarget != null}
        title={
          deleteTarget ? `Delete provider “${deleteTarget.name}”?` : "Delete"
        }
        description={
          deleteBoundCount > 0
            ? `${deleteBoundCount} catalog model${deleteBoundCount === 1 ? " is" : "s are"} bound to this provider.`
            : "This removes the provider from Settings. Catalog models without a binding are unchanged."
        }
        onCancel={() => setDeleteTarget(null)}
        footer={
          <>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="app-dialog-btn is-danger"
              onClick={() => {
                if (!deleteTarget) return;
                deleteProvider(deleteTarget.id, {
                  remapToProviderId: remapTo || null,
                });
                if (expandedId === deleteTarget.id) setExpandedId(null);
                setDeleteTarget(null);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        {deleteBoundCount > 0 ? (
          <label className="provider-field">
            <span className="provider-field-label">Move bound models to</span>
            <select
              className="sync-input"
              value={remapTo}
              onChange={(e) => setRemapTo(e.target.value)}
            >
              <option value="">Auto (unbind)</option>
              {remapOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </DialogShell>

      {importTarget ? (
        <ImportProviderModelsDialog
          open
          provider={importTarget}
          onClose={() => setImportTarget(null)}
        />
      ) : null}

      <IeltsKeyChips
        chips={IELTS_KEY_CHIPS.openai}
        keyFilled={Boolean(
          getDefaultProvider({ providers, defaultProviderId })?.apiKey.trim(),
        )}
      />
    </section>
  );
}

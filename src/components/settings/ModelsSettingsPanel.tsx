import { useEffect, useMemo, useState } from "react";
import {
  formatPerMillionPair,
  formatPerMillionTitle,
  lookupModelPrice,
} from "../../ai/modelPrices";
import { parseModelRef } from "../../ai/modelRef";
import { KIND_LABEL, TIER_LABEL } from "../../ai/models";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { useModelPricesStore } from "../../store/modelPricesStore";
import { Select, type SelectOption } from "../ui/Select";

function formatContextWindow(n: number | undefined): string {
  if (n == null || n <= 0) return "—";
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

const AUTO_PROVIDER = "__auto__";

export function ModelsSettingsPanel() {
  const models = useAiSettingsStore((s) => s.settings.models);
  const providers = useAiSettingsStore((s) => s.settings.providers);
  const addModel = useAiSettingsStore((s) => s.addModel);
  const removeModel = useAiSettingsStore((s) => s.removeModel);
  const setModelProvider = useAiSettingsStore((s) => s.setModelProvider);
  const refreshModelsFromLiteLlm = useAiSettingsStore(
    (s) => s.refreshModelsFromLiteLlm,
  );
  const prices = useModelPricesStore((s) => s.prices);
  const refreshing = useModelPricesStore((s) => s.refreshing);
  const ensureFresh = useModelPricesStore((s) => s.ensureFresh);

  const [draftId, setDraftId] = useState("");
  const [draftProvider, setDraftProvider] = useState<string>(AUTO_PROVIDER);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void ensureFresh();
  }, [ensureFresh]);

  const providerOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [{ value: AUTO_PROVIDER, label: "Auto" }];
    for (const p of providers) {
      opts.push({
        value: p.id,
        label: p.enabled ? p.name : `${p.name} (disabled)`,
      });
    }
    return opts;
  }, [providers]);

  const providerName = (id: string | null) => {
    if (!id) return "Auto";
    return providers.find((p) => p.id === id)?.name ?? "Missing provider";
  };

  const onAdd = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const providerId =
        draftProvider === AUTO_PROVIDER ? null : draftProvider;
      const result = await addModel(draftId, providerId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraftId("");
      setMessage(
        result.inMap
          ? `Added ${result.model.label}.`
          : `Added ${result.model.label} (not in LiteLLM map — using heuristics).`,
      );
    } finally {
      setBusy(false);
    }
  };

  const onRemove = (modelId: string) => {
    setError(null);
    setMessage(null);
    const result = removeModel(modelId);
    if (!result.ok) setError(result.error);
  };

  const onProviderChange = (modelId: string, next: string) => {
    setError(null);
    setMessage(null);
    const result = setModelProvider(
      modelId,
      next === AUTO_PROVIDER ? null : next,
    );
    if (!result.ok) setError(result.error);
  };

  const onRefresh = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await refreshModelsFromLiteLlm();
      setMessage("Metadata refreshed from LiteLLM.");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Catalog for chat and worker pickers. Metadata (reasoning, context,
        price) comes from the LiteLLM model map — refresh after new releases
        instead of rebuilding the app. Bind a model to a provider to force
        routing through that gateway.
      </p>

      <section className="sync-block">
        <h3 className="sync-block-title">Catalog</h3>
        <p className="sync-block-desc">
          Add a <code>vendor/model</code> id (for example{" "}
          <code>google/gemini-3.8-flash</code>). Defaults for new chats and
          specialists are chosen under Chat &amp; agent.
        </p>

        <ul className="ai-models-catalog" aria-label="Model catalog">
          {models.map((m) => {
            const { modelId: bare, providerId } = parseModelRef(m.id);
            const price = lookupModelPrice(bare, prices);
            const tier = m.tier ?? "flagship";
            const providerValue = providerId ?? AUTO_PROVIDER;
            return (
              <li key={m.id} className="ai-models-catalog-row">
                <span
                  className={
                    tier === "worker"
                      ? "chat-model-tier-dot is-worker"
                      : "chat-model-tier-dot is-flagship"
                  }
                  title={TIER_LABEL[tier]}
                  aria-label={TIER_LABEL[tier]}
                />
                <div className="ai-models-catalog-main">
                  <div className="ai-models-catalog-title">
                    <span className="ai-models-catalog-label">{m.label}</span>
                    {m.kind === "reasoning" ? (
                      <span
                        className="ai-models-catalog-badge"
                        title={KIND_LABEL.reasoning}
                      >
                        Reasoning
                      </span>
                    ) : null}
                  </div>
                  <div className="ai-models-catalog-meta">
                    <code className="ai-models-catalog-id">{m.id}</code>
                    <span>{formatContextWindow(m.contextWindow)} ctx</span>
                    {price ? (
                      <span
                        title={formatPerMillionTitle(price)}
                        aria-label={formatPerMillionTitle(price)}
                      >
                        {formatPerMillionPair(price)}
                      </span>
                    ) : (
                      <span className="ai-models-catalog-muted">no price</span>
                    )}
                    <span className="ai-models-catalog-muted">
                      {providerName(providerId)}
                    </span>
                  </div>
                </div>
                <div className="ai-models-catalog-provider">
                  <Select
                    variant="setting"
                    aria-label={`Provider for ${m.label}`}
                    value={providerValue}
                    options={providerOptions}
                    disabled={busy}
                    onChange={(v) => onProviderChange(m.id, v)}
                  />
                </div>
                <button
                  type="button"
                  className="ai-models-catalog-remove"
                  disabled={busy || models.length <= 1}
                  aria-label={`Remove ${m.label}`}
                  title="Remove"
                  onClick={() => onRemove(m.id)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>

        <div className="ai-models-catalog-add">
          <input
            type="text"
            className="sync-input ai-models-catalog-input"
            placeholder="google/gemini-3.8-flash"
            value={draftId}
            aria-label="Model id to add"
            disabled={busy}
            onChange={(e) => setDraftId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onAdd();
              }
            }}
          />
          <div className="sync-actions" style={{ marginBottom: 8 }}>
            <div style={{ minWidth: 160 }}>
              <Select
                variant="field"
                aria-label="Provider for new model"
                value={draftProvider}
                options={providerOptions}
                disabled={busy}
                onChange={setDraftProvider}
              />
            </div>
          </div>
          <div className="sync-actions">
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={busy || !draftId.trim()}
              onClick={() => void onAdd()}
            >
              Add model
            </button>
            <button
              type="button"
              className="sync-btn"
              disabled={busy || refreshing}
              onClick={() => void onRefresh()}
            >
              {refreshing || busy ? "Refreshing…" : "Refresh metadata"}
            </button>
          </div>
        </div>

        {message ? <p className="ai-models-catalog-msg">{message}</p> : null}
        {error ? (
          <p className="ai-models-catalog-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

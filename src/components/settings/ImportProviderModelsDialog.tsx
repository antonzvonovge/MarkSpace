import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { formatModelRef, parseModelRef } from "../../ai/modelRef";
import type { AiProvider } from "../../ai/types";
import { listProviderModels } from "../../lib/openAiBaseUrl";
import { useAiSettingsStore } from "../../store/aiSettingsStore";
import { DialogShell } from "../AppDialog";

type Props = {
  open: boolean;
  provider: AiProvider;
  onClose: () => void;
};

function normalizeProxyId(raw: string): string {
  const bare = parseModelRef(raw.trim()).modelId;
  if (!bare) return "";
  if (bare.includes("/")) return bare;
  if (/^gemini/i.test(bare)) return `google/${bare}`;
  return `openai/${bare}`;
}

export function ImportProviderModelsDialog({
  open,
  provider,
  onClose,
}: Props) {
  const catalog = useAiSettingsStore((s) => s.settings.models);
  const addModels = useAiSettingsStore((s) => s.addModels);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const alreadyBound = useMemo(() => {
    const set = new Set<string>();
    const suffix = `@${provider.id}`;
    for (const m of catalog) {
      if (m.id.endsWith(suffix)) {
        set.add(parseModelRef(m.id).modelId);
      }
    }
    return set;
  }, [catalog, provider.id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    setIds([]);
    setSelected(new Set());
    setQuery("");
    void listProviderModels(
      provider.apiKey,
      provider.baseUrl,
      provider.headers,
    ).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setIds(result.ids);
      const pre = new Set<string>();
      for (const id of result.ids) {
        const norm = normalizeProxyId(id);
        if (alreadyBound.has(norm)) pre.add(id);
      }
      setSelected(pre);
    });
    return () => {
      cancelled = true;
    };
    // alreadyBound intentionally omitted — seed only on open/provider change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider.id, provider.apiKey, provider.baseUrl]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return ids;
    return ids.filter((id) => id.toLowerCase().includes(q));
  }, [ids, deferredQuery]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filtered) next.add(id);
      return next;
    });
  };

  const clearVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filtered) next.delete(id);
      return next;
    });
  };

  const onImport = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const toAdd = [...selected]
        .map(normalizeProxyId)
        .filter(Boolean)
        .filter((id) => !alreadyBound.has(id));
      // Also re-add already selected that aren't bound yet handled above.
      const result = await addModels(toAdd, provider.id);
      setMessage(
        `Added ${result.added} model${result.added === 1 ? "" : "s"}${
          result.skipped ? ` (${result.skipped} skipped)` : ""
        }.`,
      );
      if (result.added) {
        // Keep dialog open briefly so the user sees the count.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const newCount = useMemo(() => {
    let n = 0;
    for (const id of selected) {
      const norm = normalizeProxyId(id);
      if (norm && !alreadyBound.has(norm)) n += 1;
    }
    return n;
  }, [selected, alreadyBound]);

  return (
    <DialogShell
      open={open}
      title={`Import models — ${provider.name}`}
      description="Select models from this provider’s /models list. Selected ids are added to the catalog bound to this provider."
      onCancel={onClose}
      wide
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={busy || loading || newCount === 0}
            onClick={() => void onImport()}
          >
            {busy
              ? "Importing…"
              : `Import ${newCount || ""}`.trim()}
          </button>
        </>
      }
    >
      <div className="provider-import">
        <div className="provider-import-toolbar">
          <input
            type="search"
            className="sync-input"
            placeholder="Filter models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
            aria-label="Filter models"
          />
          <div className="sync-actions">
            <button
              type="button"
              className="sync-btn"
              disabled={loading || filtered.length === 0}
              onClick={selectVisible}
            >
              Select visible
            </button>
            <button
              type="button"
              className="sync-btn"
              disabled={loading || filtered.length === 0}
              onClick={clearVisible}
            >
              Clear visible
            </button>
          </div>
        </div>

        {loading ? (
          <p className="sync-block-desc">Loading models…</p>
        ) : error ? (
          <p className="ai-models-catalog-error" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="sync-block-desc">No models match.</p>
        ) : (
          <div className="provider-import-list" style={{ height: 320 }}>
            <Virtuoso
              style={{ height: "100%" }}
              totalCount={filtered.length}
              itemContent={(index) => {
                const id = filtered[index]!;
                const norm = normalizeProxyId(id);
                const bound = alreadyBound.has(norm);
                const checked = selected.has(id);
                return (
                  <label
                    className={`provider-import-row${bound ? " is-bound" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(id)}
                    />
                    <span className="provider-import-id">{id}</span>
                    {bound ? (
                      <span className="ai-models-catalog-badge">In catalog</span>
                    ) : null}
                    {norm !== id ? (
                      <span className="provider-import-norm">
                        → {formatModelRef(norm, provider.id)}
                      </span>
                    ) : null}
                  </label>
                );
              }}
            />
          </div>
        )}

        {message ? <p className="ai-models-catalog-msg">{message}</p> : null}
      </div>
    </DialogShell>
  );
}

import { useEffect, useState } from "react";
import { useIndexingSettingsStore } from "../../store/indexingSettingsStore";
import { useVaultStore } from "../../store/vaultStore";

export function IndexingSettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const enabled = useIndexingSettingsStore((s) => s.enabled);
  const delaySeconds = useIndexingSettingsStore((s) => s.delaySeconds);
  const hydrate = useIndexingSettingsStore((s) => s.hydrateForVault);
  const setEnabled = useIndexingSettingsStore((s) => s.setEnabled);
  const setDelaySeconds = useIndexingSettingsStore((s) => s.setDelaySeconds);

  const [delayDraft, setDelayDraft] = useState(String(delaySeconds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate(vaultPath);
  }, [vaultPath, hydrate]);

  useEffect(() => {
    setDelayDraft(String(delaySeconds));
  }, [delaySeconds]);

  if (!vaultPath) {
    return (
      <div className="sync-panel">
        <p className="sync-panel-lead">
          Open a vault to configure semantic indexing.
        </p>
      </div>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commitDelay = () => {
    const parsed = Number(delayDraft);
    if (!Number.isFinite(parsed)) {
      setDelayDraft(String(delaySeconds));
      return;
    }
    const next = Math.max(0, Math.min(300, Math.round(parsed)));
    setDelayDraft(String(next));
    if (next === delaySeconds) return;
    void run(() => setDelaySeconds(next));
  };

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Settings for this vault on this device. Stored in the app settings
        store (not synced with the vault). Semantic embeddings run in a
        separate process; the index is also kept on this device.
      </p>
      <div className="sync-panel-vault">
        <span className="sync-vault-path" title={vaultPath}>
          {vaultPath}
        </span>
      </div>

      <section className="sync-block">
        <label className="agent-memory-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => void run(() => setEnabled(e.target.checked))}
          />
          <span>Enable semantic indexing</span>
        </label>
        <p className="sync-block-desc">
          When off, MarkSpace will not embed notes for this vault. Exact search
          still works. Download the local model in Settings → AI if you have not
          already.
        </p>
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Indexing delay (seconds)</h3>
        <p className="sync-block-desc">
          Wait this long after opening the vault (or installing the model)
          before scanning, and after each note change before re-embedding.
          Range: 0–300. Default: 5.
        </p>
        <input
          id="indexing-delay"
          className="sync-input"
          type="number"
          min={0}
          max={300}
          step={1}
          aria-label="Indexing delay in seconds"
          value={delayDraft}
          disabled={busy || !enabled}
          onChange={(e) => setDelayDraft(e.target.value)}
          onBlur={commitDelay}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
      </section>

      {error && <p className="embedding-model-error">{error}</p>}
    </div>
  );
}

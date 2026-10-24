import { useEffect, useState } from "react";
import {
  getMachineIdentity,
  setMachineName,
  type MachineIdentity,
} from "../../lib/machineApi";

export function MachineSettingsPanel() {
  const [identity, setIdentity] = useState<MachineIdentity | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMachineIdentity()
      .then((next) => {
        if (cancelled) return;
        setIdentity(next);
        setDraft(next.name);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === identity?.name) {
      if (identity) setDraft(identity.name);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await setMachineName(trimmed);
      setIdentity(next);
      setDraft(next.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      if (identity) setDraft(identity.name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sync-panel">
      <p className="sync-panel-lead">
        Used for routine placement when a job should run on one computer only.
      </p>
      <div className="setting-row">
        <div className="setting-row-text">
          <div className="setting-row-label">Computer name</div>
          <div className="setting-row-desc">
            Shown in routine “Run on” pickers across vaults on this machine.
          </div>
        </div>
        <div className="setting-row-control">
          <input
            className="setting-text"
            value={draft}
            disabled={busy || !identity}
            maxLength={80}
            aria-label="Computer name"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </div>
      </div>
      {error ? <p className="sync-status-line">{error}</p> : null}
    </div>
  );
}

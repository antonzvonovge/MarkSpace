import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AUTO_SYNC_OPTIONS,
  type AutoSyncMinutes,
} from "../../lib/settingsStore";
import { useSyncStore } from "../../store/syncStore";
import { useVaultStore } from "../../store/vaultStore";

function formatSyncTime(iso: string | null): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusSummary(
  connected: boolean,
  status: {
    dirty: boolean;
    ahead: number;
    behind: number;
    conflicted: string[];
    branch: string | null;
    remoteUrl: string | null;
  } | null,
): string {
  if (!status) return "Open a vault to sync";
  if (!connected) return "Not connected";
  const parts: string[] = [];
  if (status.remoteUrl) {
    const short = status.remoteUrl
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");
    parts.push(short);
  }
  if (status.branch) parts.push(`on ${status.branch}`);
  if (status.conflicted.length) {
    parts.push(`${status.conflicted.length} conflict(s)`);
  } else {
    if (status.dirty) parts.push("local changes");
    if (status.ahead) parts.push(`${status.ahead} ahead`);
    if (status.behind) parts.push(`${status.behind} behind`);
    if (!status.dirty && !status.ahead && !status.behind) parts.push("up to date");
  }
  return parts.join(" · ");
}

export function SyncSettingsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const saveActive = useVaultStore((s) => s.saveActive);
  const openNote = useVaultStore((s) => s.openNote);
  const markExternalWrite = useVaultStore((s) => s.markExternalWrite);
  const refreshTree = useVaultStore((s) => s.refreshTree);

  const hydrated = useSyncStore((s) => s.hydrated);
  const token = useSyncStore((s) => s.token);
  const clientIdAvailable = useSyncStore((s) => s.clientIdAvailable);
  const status = useSyncStore((s) => s.status);
  const remoteUrlInput = useSyncStore((s) => s.remoteUrlInput);
  const patInput = useSyncStore((s) => s.patInput);
  const busy = useSyncStore((s) => s.busy);
  const message = useSyncStore((s) => s.message);
  const error = useSyncStore((s) => s.error);
  const deviceFlow = useSyncStore((s) => s.deviceFlow);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const autoSyncMinutes = useSyncStore((s) => s.autoSyncMinutes);
  const hydrate = useSyncStore((s) => s.hydrate);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const loadVaultMeta = useSyncStore((s) => s.loadVaultMeta);
  const setRemoteUrlInput = useSyncStore((s) => s.setRemoteUrlInput);
  const setPatInput = useSyncStore((s) => s.setPatInput);
  const setAutoSyncMinutes = useSyncStore((s) => s.setAutoSyncMinutes);
  const savePat = useSyncStore((s) => s.savePat);
  const clearToken = useSyncStore((s) => s.clearToken);
  const connect = useSyncStore((s) => s.connect);
  const disconnect = useSyncStore((s) => s.disconnect);
  const runSync = useSyncStore((s) => s.runSync);
  const startDeviceFlow = useSyncStore((s) => s.startDeviceFlow);
  const cancelDeviceFlow = useSyncStore((s) => s.cancelDeviceFlow);
  const resolveConflict = useSyncStore((s) => s.resolveConflict);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (!vaultPath) return;
    void (async () => {
      await refreshStatus();
      await loadVaultMeta(vaultPath);
    })();
  }, [vaultPath, refreshStatus, loadVaultMeta]);

  const connected = Boolean(status?.connected);

  const onSync = async () => {
    if (!vaultPath) return;
    await runSync(vaultPath, async () => {
      await saveActive();
    });
    markExternalWrite();
    await refreshTree();
  };

  return (
    <div className="sync-panel">
      {!vaultPath && (
        <p className="sync-panel-lead">
          Open a vault folder first. Sync is configured per vault — each folder
          can connect to its own GitHub repository.
        </p>
      )}

      {vaultPath && (
        <>
          <p className="sync-panel-lead sync-panel-vault">
            Settings for this vault only
            <code className="sync-vault-path" title={vaultPath}>
              {vaultPath}
            </code>
          </p>

          <section className="sync-block">
            <h3 className="sync-block-title">Status</h3>
            <p className="sync-status-line">
              {statusSummary(connected, status)}
            </p>
            <p className="sync-meta">Last sync: {formatSyncTime(lastSyncAt)}</p>
          </section>

          <section className="sync-block">
            <h3 className="sync-block-title">Repository</h3>
            <p className="sync-block-desc">
              GitHub URL or <code>owner/repo</code>. A private repo is recommended
              for personal notes.
            </p>
            <input
              className="sync-input"
              type="text"
              placeholder="https://github.com/you/notes.git"
              value={remoteUrlInput}
              disabled={busy}
              onChange={(e) => setRemoteUrlInput(e.target.value)}
            />
            <div className="sync-actions">
              <button
                type="button"
                className="sync-btn sync-btn-primary"
                disabled={busy || !remoteUrlInput.trim()}
                onClick={() => void connect(vaultPath)}
              >
                {connected ? "Update remote" : "Connect"}
              </button>
              {connected && (
                <button
                  type="button"
                  className="sync-btn"
                  disabled={busy}
                  onClick={() => void disconnect(vaultPath)}
                >
                  Disconnect
                </button>
              )}
              <button
                type="button"
                className="sync-btn sync-btn-primary"
                disabled={busy || !connected}
                onClick={() => void onSync()}
              >
                Sync Now
              </button>
            </div>
          </section>

          <section className="sync-block">
            <h3 className="sync-block-title">Auto-sync</h3>
            <p className="sync-block-desc">
              Periodically push and pull this vault while MarkSpace is open.
              Also syncs when you return to the window. Skips if there are
              unresolved conflicts.
            </p>
            <select
              className="sync-input sync-select"
              aria-label="Auto-sync interval"
              value={autoSyncMinutes}
              disabled={busy || !connected}
              onChange={(e) => {
                const value = Number(e.target.value) as AutoSyncMinutes;
                void setAutoSyncMinutes(vaultPath, value);
              }}
            >
              {AUTO_SYNC_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </section>

          <section className="sync-block">
            <h3 className="sync-block-title">GitHub account</h3>
            <p className="sync-block-desc">
              {token
                ? "Signed in — token stored on this machine only."
                : "Sign in to push and pull private repositories."}
            </p>
            <div className="sync-actions">
              {clientIdAvailable && !token && (
                <button
                  type="button"
                  className="sync-btn sync-btn-primary"
                  disabled={busy || Boolean(deviceFlow)}
                  onClick={() => void startDeviceFlow()}
                >
                  Sign in with GitHub
                </button>
              )}
              {token && (
                <button
                  type="button"
                  className="sync-btn"
                  disabled={busy}
                  onClick={() => void clearToken()}
                >
                  Sign out
                </button>
              )}
            </div>

            {deviceFlow && (
              <div className="sync-device-flow">
                <p>
                  Open{" "}
                  <button
                    type="button"
                    className="sync-link-btn"
                    onClick={() => void openUrl(deviceFlow.verificationUri)}
                  >
                    {deviceFlow.verificationUri}
                  </button>{" "}
                  and enter code:
                </p>
                <p className="sync-user-code">{deviceFlow.userCode}</p>
                <button
                  type="button"
                  className="sync-btn"
                  onClick={cancelDeviceFlow}
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="sync-pat">
              <label className="sync-pat-label" htmlFor="sync-pat">
                Personal Access Token
              </label>
              <p className="sync-block-desc">
                Create a classic PAT with the <code>repo</code> scope, or a fine-grained
                token with Contents read/write on the vault repository.
              </p>
              <input
                id="sync-pat"
                className="sync-input"
                type="password"
                autoComplete="off"
                placeholder={token ? "•••••••• (saved)" : "ghp_…"}
                value={patInput}
                disabled={busy}
                onChange={(e) => setPatInput(e.target.value)}
              />
              <div className="sync-actions">
                <button
                  type="button"
                  className="sync-btn"
                  disabled={busy || !patInput.trim()}
                  onClick={() => void savePat()}
                >
                  Save token
                </button>
              </div>
            </div>
          </section>

          {status && status.conflicted.length > 0 && (
            <section className="sync-block sync-conflicts">
              <h3 className="sync-block-title">Conflicts</h3>
              <p className="sync-block-desc">
                Choose which version to keep, or open the file and edit markers
                manually, then Sync again.
              </p>
              <ul className="sync-conflict-list">
                {status.conflicted.map((path) => (
                  <li key={path} className="sync-conflict-item">
                    <button
                      type="button"
                      className="sync-link-btn"
                      onClick={() => void openNote(path, { preview: false })}
                    >
                      {path}
                    </button>
                    <div className="sync-actions">
                      <button
                        type="button"
                        className="sync-btn"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            await resolveConflict(path, "ours");
                            markExternalWrite();
                            await refreshTree();
                            await openNote(path, { preview: false });
                          })()
                        }
                      >
                        Keep mine
                      </button>
                      <button
                        type="button"
                        className="sync-btn"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            await resolveConflict(path, "theirs");
                            markExternalWrite();
                            await refreshTree();
                            await openNote(path, { preview: false });
                          })()
                        }
                      >
                        Keep theirs
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {message && <p className="sync-feedback is-ok">{message}</p>}
      {error && <p className="sync-feedback is-error">{error}</p>}
    </div>
  );
}

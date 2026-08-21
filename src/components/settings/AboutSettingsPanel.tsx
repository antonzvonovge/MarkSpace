import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; version: string; progress: string | null }
  | { kind: "error"; message: string };

export function AboutSettingsPanel() {
  const [version, setVersion] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const v = await getVersion();
        if (!cancelled) setVersion(v);
      } catch {
        if (!cancelled) setVersion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const checkForUpdates = async () => {
    setCheckState({ kind: "checking" });
    try {
      const update = await check();
      if (!update) {
        setCheckState({ kind: "upToDate" });
        return;
      }
      setCheckState({ kind: "available", update });
    } catch (e) {
      setCheckState({
        kind: "error",
        message: e instanceof Error ? e.message : "Could not check for updates",
      });
    }
  };

  const installUpdate = async (update: Update) => {
    setCheckState({
      kind: "downloading",
      version: update.version,
      progress: null,
    });
    try {
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setCheckState({
              kind: "downloading",
              version: update.version,
              progress: contentLength ? "0%" : "Downloading…",
            });
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setCheckState({
                kind: "downloading",
                version: update.version,
                progress: `${Math.min(100, Math.round((downloaded / contentLength) * 100))}%`,
              });
            }
            break;
          case "Finished":
            setCheckState({
              kind: "downloading",
              version: update.version,
              progress: "Installing…",
            });
            break;
        }
      });
      await relaunch();
    } catch (e) {
      setCheckState({
        kind: "error",
        message: e instanceof Error ? e.message : "Update failed",
      });
    }
  };

  const busy =
    checkState.kind === "checking" || checkState.kind === "downloading";

  return (
    <div className="sync-panel about-panel">
      <p className="sync-panel-lead">
        MarkSpace — a markdown workspace for notes, projects, and AI chat.
      </p>

      <section className="sync-block">
        <h3 className="sync-block-title">Version</h3>
        <p className="sync-block-desc about-version">
          {version ? `MarkSpace ${version}` : "Loading…"}
        </p>
      </section>

      <section className="sync-block">
        <h3 className="sync-block-title">Updates</h3>
        <p className="sync-block-desc">
          Check GitHub for a newer release and install it when available.
        </p>

        <div className="sync-actions">
          {checkState.kind === "available" ? (
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={busy}
              onClick={() => void installUpdate(checkState.update)}
            >
              Update to {checkState.update.version}
            </button>
          ) : (
            <button
              type="button"
              className="sync-btn sync-btn-primary"
              disabled={busy}
              onClick={() => void checkForUpdates()}
            >
              {checkState.kind === "checking"
                ? "Checking…"
                : "Check for updates"}
            </button>
          )}

          {checkState.kind === "available" && (
            <button
              type="button"
              className="sync-btn"
              disabled={busy}
              onClick={() => void checkForUpdates()}
            >
              Check again
            </button>
          )}
        </div>

        {checkState.kind === "upToDate" && (
          <p className="about-update-status">You are up to date.</p>
        )}
        {checkState.kind === "available" && (
          <p className="about-update-status">
            MarkSpace {checkState.update.version} is available.
          </p>
        )}
        {checkState.kind === "downloading" && (
          <p className="about-update-status">
            Updating to {checkState.version}
            {checkState.progress ? ` · ${checkState.progress}` : "…"}
          </p>
        )}
        {checkState.kind === "error" && (
          <p className="about-update-status is-error">{checkState.message}</p>
        )}
      </section>
    </div>
  );
}

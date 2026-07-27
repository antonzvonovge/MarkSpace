import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Status = "idle" | "available" | "downloading" | "error";

export function UpdateBanner() {
  const [status, setStatus] = useState<Status>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;
        setVersion(update.version);
        setStatus("available");
      } catch {
        // Offline / no release yet — ignore quietly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async () => {
    setStatus("downloading");
    setError(null);
    setProgress(null);
    try {
      const update = await check();
      if (!update) {
        setStatus("idle");
        return;
      }

      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setProgress(contentLength ? `0%` : "Downloading…");
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(`${Math.min(100, Math.round((downloaded / contentLength) * 100))}%`);
            }
            break;
          case "Finished":
            setProgress("Installing…");
            break;
        }
      });
      await relaunch();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (status === "idle") return null;

  return (
    <div className={status === "error" ? "update-banner is-error" : "update-banner"}>
      {status === "available" && (
        <>
          <span>MarkSpace {version} is available.</span>
          <button type="button" className="update-banner-btn" onClick={() => void install()}>
            Update now
          </button>
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={() => setStatus("idle")}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      )}
      {status === "downloading" && (
        <span>Updating{progress ? ` · ${progress}` : "…"}</span>
      )}
      {status === "error" && (
        <>
          <span>{error ?? "Update failed"}</span>
          <button type="button" className="update-banner-btn" onClick={() => void install()}>
            Retry
          </button>
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={() => setStatus("idle")}
            aria-label="Dismiss"
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

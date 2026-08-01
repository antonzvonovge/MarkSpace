import { useEffect, useRef, useState } from "react";
import {
  useBackgroundJobsStore,
  type BackgroundJob,
} from "../store/backgroundJobsStore";
import { usePrefsStore } from "../store/prefsStore";
import { useSyncStore } from "../store/syncStore";
import { useVaultStore } from "../store/vaultStore";

function SyncIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={spinning ? "status-sync-icon is-spinning" : "status-sync-icon"}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3 8a5 5 0 0 1 8.9-2.1M13 4v2.5H10.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 8a5 5 0 0 1-8.9 2.1M3 12v-2.5H5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="status-sync-icon is-spinning"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="22 10"
        strokeLinecap="round"
      />
    </svg>
  );
}

function jobTitle(job: BackgroundJob): string {
  const parts = [job.label];
  if (job.status === "running" || job.status === "done") {
    parts.push(`${job.progress}%`);
  }
  if (job.status === "error") parts.push("error");
  return parts.join(" · ");
}

function relativeSyncAge(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diff = Math.max(0, nowMs - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function syncLabel(opts: {
  vaultPath: string | null;
  connected: boolean;
  busy: boolean;
  conflicted: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  lastSyncAt: string | null;
  nowMs: number;
}): string {
  const {
    vaultPath,
    connected,
    busy,
    conflicted,
    dirty,
    ahead,
    behind,
    lastSyncAt,
    nowMs,
  } = opts;
  if (!vaultPath) return "No vault";
  if (busy) return "Syncing…";
  if (!connected) return "Sync off";
  if (conflicted) return "Conflicts";
  const age = relativeSyncAge(lastSyncAt, nowMs);
  const parts: string[] = [];
  if (ahead) parts.push(`↑${ahead}`);
  if (behind) parts.push(`↓${behind}`);
  if (dirty) parts.push("•");
  if (parts.length) {
    return age ? `${parts.join(" ")} · ${age}` : parts.join(" ");
  }
  if (!lastSyncAt) return "Never synced";
  return age ? `Synced · ${age}` : "Synced";
}

export function StatusBar() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const saveActive = useVaultStore((s) => s.saveActive);
  const markExternalWrite = useVaultStore((s) => s.markExternalWrite);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const openSettings = usePrefsStore((s) => s.openSettings);

  const status = useSyncStore((s) => s.status);
  const busy = useSyncStore((s) => s.busy);
  const autoSyncMinutes = useSyncStore((s) => s.autoSyncMinutes);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const hydrate = useSyncStore((s) => s.hydrate);
  const hydrated = useSyncStore((s) => s.hydrated);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const runSync = useSyncStore((s) => s.runSync);
  const jobsMap = useBackgroundJobsStore((s) => s.jobs);
  const bgJobs = Object.values(jobsMap).filter(
    (j) =>
      j.status === "running" || j.status === "error" || j.status === "done",
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (!vaultPath) return;
    void refreshStatus();
  }, [vaultPath, refreshStatus]);

  useEffect(() => {
    if (!lastSyncAt || !status?.connected) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [lastSyncAt, status?.connected]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const connected = Boolean(status?.connected);
  const conflicted = (status?.conflicted.length ?? 0) > 0;
  const dirty = Boolean(status?.dirty);
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const label = syncLabel({
    vaultPath,
    connected,
    busy,
    conflicted,
    dirty,
    ahead,
    behind,
    lastSyncAt,
    nowMs,
  });
  const titleParts = ["GitHub sync"];
  if (autoSyncMinutes > 0) titleParts.push(`auto every ${autoSyncMinutes}m`);
  if (lastSyncAt) {
    try {
      titleParts.push(`last ${new Date(lastSyncAt).toLocaleString()}`);
    } catch {
      /* ignore */
    }
  }
  const title = titleParts.join(" · ");

  const tone = conflicted
    ? "is-conflict"
    : busy
      ? "is-busy"
      : connected && (dirty || ahead || behind)
        ? "is-pending"
        : connected
          ? "is-synced"
          : "";

  const forceSync = async () => {
    setMenuOpen(false);
    if (!vaultPath) {
      openSettings("sync");
      return;
    }
    if (!connected || conflicted) {
      openSettings("sync");
      return;
    }
    await runSync(vaultPath, async () => {
      await saveActive();
    });
    markExternalWrite();
    await refreshTree();
    await refreshStatus();
  };

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        {bgJobs.map((job) => (
          <span
            key={job.id}
            className={
              job.status === "error"
                ? "status-bar-item is-conflict"
                : job.status === "running"
                  ? "status-bar-item is-busy"
                  : "status-bar-item"
            }
            title={job.detail ? `${jobTitle(job)} · ${job.detail}` : jobTitle(job)}
          >
            {job.status === "running" ? <SpinnerIcon /> : null}
            <span>{jobTitle(job)}</span>
          </span>
        ))}
      </div>
      <div className="status-bar-right" ref={rootRef}>
        <button
          type="button"
          className={
            menuOpen
              ? `status-bar-item is-open ${tone}`.trim()
              : `status-bar-item ${tone}`.trim()
          }
          title={title}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={busy}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <SyncIcon spinning={busy} />
          <span>{label}</span>
        </button>

        {menuOpen && (
          <div className="status-bar-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="status-bar-menu-item"
              disabled={busy || !vaultPath}
              onClick={() => void forceSync()}
            >
              <SyncIcon />
              <span>Synchronize</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="status-bar-menu-item"
              onClick={() => {
                setMenuOpen(false);
                openSettings("sync");
              }}
            >
              <span>Sync settings…</span>
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}

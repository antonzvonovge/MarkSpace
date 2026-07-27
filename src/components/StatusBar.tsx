import { useEffect, useRef, useState } from "react";
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

function syncLabel(opts: {
  vaultPath: string | null;
  connected: boolean;
  busy: boolean;
  conflicted: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  autoSyncMinutes: number;
}): string {
  const {
    vaultPath,
    connected,
    busy,
    conflicted,
    dirty,
    ahead,
    behind,
    autoSyncMinutes,
  } = opts;
  if (!vaultPath) return "No vault";
  if (busy) return "Syncing…";
  if (!connected) return "Sync off";
  if (conflicted) return "Conflicts";
  const parts: string[] = [];
  if (ahead) parts.push(`↑${ahead}`);
  if (behind) parts.push(`↓${behind}`);
  if (dirty) parts.push("•");
  if (parts.length) return parts.join(" ");
  return autoSyncMinutes > 0 ? `Synced · auto ${autoSyncMinutes}m` : "Synced";
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
  const hydrate = useSyncStore((s) => s.hydrate);
  const hydrated = useSyncStore((s) => s.hydrated);
  const refreshStatus = useSyncStore((s) => s.refreshStatus);
  const runSync = useSyncStore((s) => s.runSync);

  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (!vaultPath) return;
    void refreshStatus();
  }, [vaultPath, refreshStatus]);

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
    autoSyncMinutes,
  });

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
      <div className="status-bar-left" />
      <div className="status-bar-right" ref={rootRef}>
        <button
          type="button"
          className={
            menuOpen
              ? `status-bar-item is-open ${tone}`.trim()
              : `status-bar-item ${tone}`.trim()
          }
          title="GitHub sync"
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

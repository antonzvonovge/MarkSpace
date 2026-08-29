import { useEffect, useRef, useState } from "react";
import { BackgroundJobsList } from "./BackgroundJobsList";
import { usePrefsStore } from "../store/prefsStore";
import { useSyncStore } from "../store/syncStore";
import { useVaultStore } from "../store/vaultStore";
import { documentKind } from "../lib/vaultApi";
import { countWords } from "../lib/wordCount";
import { MenuSettingsIcon, MenuSyncIcon } from "./menuIcons";

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

function selectionWordCount(): number | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString();
  if (!text.trim()) return null;

  const anchor =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
  if (!anchor) return null;
  const inEditor = anchor.closest(
    ".document-instance.is-active .document-editor-slot.is-active :is(.bn-container, .cm-editor)",
  );
  if (!inEditor) return null;
  return countWords(text);
}

function liveMarkdownWordCount(): number | null {
  const activePath = useVaultStore.getState().activePath;
  const viewMode = useVaultStore.getState().viewMode;
  if (!activePath || documentKind(activePath) !== "markdown") return null;
  if (viewMode !== "live") return null;

  const editor = document.querySelector(
    ".document-instance.is-active .document-editor-slot.is-active .bn-editor",
  );
  if (!(editor instanceof HTMLElement)) return null;
  return countWords(editor.innerText || editor.textContent || "");
}

function WordCountItem() {
  const activePath = useVaultStore((s) => s.activePath);
  const viewMode = useVaultStore((s) => s.viewMode);
  const content = useVaultStore((s) => s.content);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    let syncTimer: number | null = null;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selected = selectionWordCount();
        if (selected != null) {
          setLabel(`${selected.toLocaleString()} words`);
          return;
        }
        const live = liveMarkdownWordCount();
        if (live != null) {
          setLabel(`${live.toLocaleString()} words`);
          return;
        }
        setLabel(null);
      });
    };
    const scheduleSync = () => {
      // innerText of the whole Live editor is costly; coalesce input + selection.
      if (syncTimer != null) return;
      syncTimer = window.setTimeout(() => {
        syncTimer = null;
        sync();
      }, 300);
    };

    sync();
    document.addEventListener("selectionchange", scheduleSync);
    document.addEventListener("input", scheduleSync, true);
    return () => {
      cancelAnimationFrame(frame);
      if (syncTimer != null) window.clearTimeout(syncTimer);
      document.removeEventListener("selectionchange", scheduleSync);
      document.removeEventListener("input", scheduleSync, true);
    };
  }, [activePath, viewMode, content]);

  if (!label) return null;
  return (
    <span className="status-bar-item status-bar-words" title={label}>
      {label}
    </span>
  );
}

function TimerIcon() {
  return (
    <svg
      className="status-sync-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8.5"
        r="5.25"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M8 6.25v2.5l1.75 1.05"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.25 2.75h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      className="status-sync-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.5 4.25v7.5M10.5 4.25v7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      className="status-sync-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 4.4v7.2l6-3.6-6-3.6z"
        fill="currentColor"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      className="status-sync-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="4.75"
        y="4.75"
        width="6.5"
        height="6.5"
        rx="0.75"
        fill="currentColor"
      />
    </svg>
  );
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function TimerItem() {
  const [mode, setMode] = useState<"idle" | "running" | "paused">("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const baseElapsedRef = useRef(0);

  useEffect(() => {
    if (mode !== "running") return;
    const tick = () => {
      setElapsedMs(baseElapsedRef.current + (Date.now() - startedAtRef.current));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [mode]);

  const start = () => {
    baseElapsedRef.current = 0;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setMode("running");
  };

  const pause = () => {
    baseElapsedRef.current =
      baseElapsedRef.current + (Date.now() - startedAtRef.current);
    setElapsedMs(baseElapsedRef.current);
    setMode("paused");
  };

  const resume = () => {
    startedAtRef.current = Date.now();
    setMode("running");
  };

  const stop = () => {
    const final =
      mode === "running"
        ? baseElapsedRef.current + (Date.now() - startedAtRef.current)
        : baseElapsedRef.current;
    baseElapsedRef.current = final;
    startedAtRef.current = 0;
    setElapsedMs(final);
    setMode("idle");
  };

  const active = mode !== "idle";
  const label = formatElapsed(elapsedMs);
  const tone =
    mode === "running"
      ? "is-running"
      : mode === "paused"
        ? "is-paused"
        : "is-stopped";

  return (
    <div className={`status-bar-timer ${tone}`}>
      {active ? (
        <span
          className="status-bar-item status-bar-timer-time"
          title={mode === "running" ? "Timer running" : "Timer paused"}
        >
          <TimerIcon />
          <span>{label}</span>
        </span>
      ) : (
        <button
          type="button"
          className="status-bar-item status-bar-timer-time status-bar-timer-btn"
          title="Start timer"
          aria-label="Start timer"
          onClick={start}
        >
          <TimerIcon />
          <span>{label}</span>
        </button>
      )}
      {active ? (
        <>
          <button
            type="button"
            className="status-bar-item status-bar-timer-btn"
            title={mode === "running" ? "Pause timer" : "Resume timer"}
            aria-label={mode === "running" ? "Pause timer" : "Resume timer"}
            onClick={mode === "running" ? pause : resume}
          >
            {mode === "running" ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="status-bar-item status-bar-timer-btn"
            title="Stop timer"
            aria-label="Stop timer"
            onClick={stop}
          >
            <StopIcon />
          </button>
        </>
      ) : null}
    </div>
  );
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
      <BackgroundJobsList />
      <div className="status-bar-right" ref={rootRef}>
        <WordCountItem />
        <TimerItem />
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
              <MenuSyncIcon />
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
              <MenuSettingsIcon />
              <span>Sync settings…</span>
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}

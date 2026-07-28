import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
} from "react-resizable-panels";
import { Sidebar, loadLastVault } from "./components/Sidebar";
import { ChatSidebar } from "./components/chat/ChatSidebar";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { SettingsPage } from "./components/settings/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { SyncConflictBanner } from "./components/SyncConflictBanner";
import { EditorChrome } from "./components/TabBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { NoteEditor } from "./editor/NoteEditor";
import { DrawioEditor } from "./editor/drawio/DrawioEditor";
import type { VaultChange } from "./lib/vaultApi";
import { documentKind, readNote } from "./lib/vaultApi";
import {
  loadShellLayout,
  saveShellLayout,
  toGroupLayout,
  type ShellLayout,
} from "./lib/shellLayout";
import { useAiSettingsStore } from "./store/aiSettingsStore";
import { useChatUiStore } from "./store/chatUiStore";
import { usePrefsStore } from "./store/prefsStore";
import { useSidebarUiStore } from "./store/sidebarUiStore";
import { useSyncStore } from "./store/syncStore";
import { useVaultStore } from "./store/vaultStore";
import { useAutoSync } from "./hooks/useAutoSync";
import "./App.css";

function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const activePath = useVaultStore((s) => s.activePath);
  const content = useVaultStore((s) => s.content);
  const viewMode = useVaultStore((s) => s.viewMode);
  const error = useVaultStore((s) => s.error);
  const setContent = useVaultStore((s) => s.setContent);
  const toggleViewMode = useVaultStore((s) => s.toggleViewMode);
  const saveActive = useVaultStore((s) => s.saveActive);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const settingsOpen = usePrefsStore((s) => s.settingsOpen);
  const openSettings = usePrefsStore((s) => s.openSettings);
  const closeSettings = usePrefsStore((s) => s.closeSettings);
  const hydratePrefs = usePrefsStore((s) => s.hydrate);
  const hydrateAi = useAiSettingsStore((s) => s.hydrate);
  const refreshSyncStatus = useSyncStore((s) => s.refreshStatus);
  const sidebarOpen = useSidebarUiStore((s) => s.open);
  const chatOpen = useChatUiStore((s) => s.open);
  const toggleChat = useChatUiStore((s) => s.toggle);
  const timer = useRef<number | null>(null);
  const groupRef = useGroupRef();
  const applyingRef = useRef(false);
  const savedRef = useRef<ShellLayout>(loadShellLayout());
  const initialLayout = toGroupLayout(savedRef.current, chatOpen, sidebarOpen);

  useAutoSync();

  useEffect(() => {
    void hydratePrefs();
    void hydrateAi();
  }, [hydratePrefs, hydrateAi]);

  useEffect(() => {
    void (async () => {
      const last = await loadLastVault();
      if (last) await openVaultAt(last);
    })();
  }, [openVaultAt]);

  // Re-apply persisted sizes when sidebar/chat open state changes (and once on mount).
  useEffect(() => {
    let tries = 0;
    const apply = () => {
      const group = groupRef.current;
      if (!group) {
        if (tries++ < 40) requestAnimationFrame(apply);
        return;
      }
      const next = toGroupLayout(savedRef.current, chatOpen, sidebarOpen);
      applyingRef.current = true;
      try {
        group.setLayout(next);
      } catch {
        // group may not be ready
      } finally {
        // Allow layout callbacks from setLayout to settle first
        requestAnimationFrame(() => {
          applyingRef.current = false;
        });
      }
    };
    const id = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(id);
  }, [chatOpen, sidebarOpen, groupRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) {
        if (e.key === "Escape" && usePrefsStore.getState().settingsOpen) {
          e.preventDefault();
          closeSettings();
        }
        return;
      }

      const code = e.code;
      if (code === "KeyS") {
        e.preventDefault();
        void saveActive();
      }
      if (code === "KeyE") {
        e.preventDefault();
        const path = useVaultStore.getState().activePath;
        if (path && documentKind(path) === "drawio") return;
        toggleViewMode();
      }
      if (e.key === "," || code === "Comma") {
        e.preventDefault();
        openSettings();
      }
      if (e.shiftKey && code === "KeyL") {
        e.preventDefault();
        toggleChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, toggleViewMode, openSettings, closeSettings, toggleChat]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let debounceTimer: number | null = null;
    const pendingPaths = new Set<string>();

    const flush = async () => {
      debounceTimer = null;
      if (useSyncStore.getState().busy) {
        debounceTimer = window.setTimeout(() => void flush(), 400);
        return;
      }
      if (Date.now() < useVaultStore.getState().suppressWatchUntil) {
        pendingPaths.clear();
        return;
      }

      const paths = [...pendingPaths];
      pendingPaths.clear();

      await refreshTree();
      void refreshSyncStatus();

      const { activePath: current, dirty } = useVaultStore.getState();
      if (!current || dirty) return;
      const hit = paths.some(
        (path) =>
          path === current ||
          path.endsWith(`/${current}`) ||
          current.endsWith(path),
      );
      if (!hit) return;
      try {
        const next = await readNote(current);
        useVaultStore.setState({ content: next, dirty: false });
      } catch {
        // file may have been deleted
      }
    };

    void listen<VaultChange>("vault-change", (event) => {
      pendingPaths.add(event.payload.path);
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void flush(), 400);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
    };
  }, [refreshTree, refreshSyncStatus]);

  const onEditorChange = (markdown: string) => {
    setContent(markdown);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveActive();
    }, 500);
  };

  const panelClass = [
    "app-panels",
    sidebarOpen ? "" : "is-sidebar-collapsed",
    chatOpen ? "" : "is-chat-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-shell">
      <UpdateBanner />
      <Group
        className={panelClass}
        orientation="horizontal"
        groupRef={groupRef}
        defaultLayout={initialLayout}
        onLayoutChanged={(layout, meta) => {
          // Ignore programmatic setLayout / collapse noise — that was wiping sizes.
          if (applyingRef.current || !meta.isUserInteraction) return;

          const sidebarPct = layout.sidebar;
          const chatPct = layout.chat;
          if (typeof sidebarPct !== "number" || !Number.isFinite(sidebarPct)) {
            return;
          }

          const next: ShellLayout = {
            sidebar:
              sidebarPct >= 5 ? sidebarPct : savedRef.current.sidebar,
            chat:
              typeof chatPct === "number" && chatPct >= 5
                ? chatPct
                : savedRef.current.chat,
          };
          savedRef.current = next;
          saveShellLayout(next);
          if (sidebarPct >= 5) {
            useSidebarUiStore.getState().rememberSizePercent(sidebarPct);
          }
          if (typeof chatPct === "number" && chatPct >= 5) {
            useChatUiStore.getState().rememberSizePercent(chatPct);
          }
        }}
      >
        <Panel
          id="sidebar"
          className="sidebar-panel"
          collapsible
          collapsedSize={0}
          defaultSize={`${initialLayout.sidebar}%`}
          minSize={200}
          maxSize={480}
          groupResizeBehavior="preserve-pixel-size"
        >
          <Sidebar />
        </Panel>

        <Separator
          className="app-splitter app-splitter-sidebar"
          disabled={!sidebarOpen}
        />

        <Panel
          id="main"
          className="main-panel"
          defaultSize={`${initialLayout.main}%`}
          minSize={360}
        >
          <main className="main-pane">
            {error && <div className="error-banner">{error}</div>}
            <SyncConflictBanner />
            <div className="main-pane-body">
              {settingsOpen ? (
                <SettingsPage onClose={closeSettings} />
              ) : (
                <>
                  {!vaultPath && (
                    <div className="empty-state">
                      <h1>MarkSpace</h1>
                      <p>
                        Open a local folder as your vault. Notes are plain Markdown — editable here
                        or in VS Code / Cursor.
                      </p>
                    </div>
                  )}
                  {vaultPath && (
                    <>
                      <EditorChrome />
                      {!activePath && (
                        <div className="empty-state">
                          <h1>Select a note</h1>
                          <p>Or create one from the sidebar.</p>
                        </div>
                      )}
                      {activePath && (
                        <div className="document-column">
                          {documentKind(activePath) === "markdown" ? (
                            <DocumentToolbar />
                          ) : null}
                          <div className="document-body">
                            {documentKind(activePath) === "drawio" ? (
                              <DrawioEditor
                                key={activePath}
                                path={activePath}
                                content={content}
                                onChange={onEditorChange}
                              />
                            ) : viewMode === "live" ? (
                              <NoteEditor
                                key={activePath}
                                path={activePath}
                                content={content}
                                onChange={onEditorChange}
                              />
                            ) : (
                              <MarkdownSourceEditor
                                key={activePath}
                                path={activePath}
                                content={content}
                                onChange={onEditorChange}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
            <StatusBar />
          </main>
        </Panel>

        <Separator
          className="app-splitter app-splitter-chat"
          disabled={!chatOpen}
        />

        <Panel
          id="chat"
          className="chat-panel-host"
          collapsible
          collapsedSize={0}
          defaultSize={`${initialLayout.chat}%`}
          minSize={280}
          maxSize={800}
          groupResizeBehavior="preserve-pixel-size"
        >
          <ChatSidebar />
        </Panel>
      </Group>
    </div>
  );
}

export default App;

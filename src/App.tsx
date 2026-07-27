import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from "react-resizable-panels";
import { Sidebar, loadLastVault } from "./components/Sidebar";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { SettingsPage } from "./components/settings/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { SyncConflictBanner } from "./components/SyncConflictBanner";
import { TabBar } from "./components/TabBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { NoteEditor } from "./editor/NoteEditor";
import { DrawioEditor } from "./editor/drawio/DrawioEditor";
import type { VaultChange } from "./lib/vaultApi";
import { documentKind, readNote } from "./lib/vaultApi";
import { usePrefsStore } from "./store/prefsStore";
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
  const suppressWatchUntil = useVaultStore((s) => s.suppressWatchUntil);
  const settingsOpen = usePrefsStore((s) => s.settingsOpen);
  const openSettings = usePrefsStore((s) => s.openSettings);
  const closeSettings = usePrefsStore((s) => s.closeSettings);
  const hydratePrefs = usePrefsStore((s) => s.hydrate);
  const refreshSyncStatus = useSyncStore((s) => s.refreshStatus);
  const timer = useRef<number | null>(null);

  useAutoSync();

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "markspace-shell",
    storage: localStorage,
  });

  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);

  useEffect(() => {
    void (async () => {
      const last = await loadLastVault();
      if (last) await openVaultAt(last);
    })();
  }, [openVaultAt]);

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

      // Use event.code so shortcuts work on non-English layouts (e.g. Ctrl+Ы).
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
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, toggleViewMode, openSettings, closeSettings]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<VaultChange>("vault-change", async (event) => {
      if (Date.now() < useVaultStore.getState().suppressWatchUntil) return;
      await refreshTree();
      void refreshSyncStatus();
      const { activePath: current, dirty } = useVaultStore.getState();
      if (!current || dirty) return;
      if (
        event.payload.path === current ||
        event.payload.path.endsWith(`/${current}`) ||
        current.endsWith(event.payload.path)
      ) {
        try {
          const next = await readNote(current);
          useVaultStore.setState({ content: next, dirty: false });
        } catch {
          // file may have been deleted
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshTree, suppressWatchUntil, refreshSyncStatus]);

  const onEditorChange = (markdown: string) => {
    setContent(markdown);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void saveActive();
    }, 500);
  };

  return (
    <div className="app-shell">
      <UpdateBanner />
      <Group
        className="app-panels"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <Panel
          id="sidebar"
          className="sidebar-panel"
          defaultSize={280}
          minSize={200}
          maxSize={480}
          groupResizeBehavior="preserve-pixel-size"
        >
          <Sidebar />
        </Panel>

        <Separator className="app-splitter" />

        <Panel id="main" className="main-panel" minSize={360}>
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
                  {vaultPath && !activePath && (
                    <div className="empty-state">
                      <h1>Select a note</h1>
                      <p>Or create one from the sidebar.</p>
                    </div>
                  )}
                  {activePath && (
                    <>
                      <TabBar />
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
                    </>
                  )}
                </>
              )}
            </div>
            <StatusBar />
          </main>
        </Panel>
      </Group>
    </div>
  );
}

export default App;

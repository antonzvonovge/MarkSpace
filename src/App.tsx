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
import { SelectionToChatButton } from "./components/chat/SelectionToChatButton";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { SettingsPage } from "./components/settings/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { SyncConflictBanner } from "./components/SyncConflictBanner";
import { EditorChrome } from "./components/TabBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { PageTags } from "./components/PageTags";
import { TagGraphView } from "./components/graph/TagGraphView";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { PlainSourceEditor } from "./editor/PlainSourceEditor";
import { NoteEditor } from "./editor/NoteEditor";
import { DrawioEditor } from "./editor/drawio/DrawioEditor";
import { LinksEditor } from "./editor/mdlnks/LinksEditor";
import type { VaultChange } from "./lib/vaultApi";
import { documentKind, readNote } from "./lib/vaultApi";
import {
  loadShellLayout,
  saveShellLayout,
  toGroupLayout,
  type ShellLayout,
} from "./lib/shellLayout";
import { useAiSettingsStore } from "./store/aiSettingsStore";
import { applyBackgroundJobPayload } from "./store/backgroundJobsStore";
import { useChatUiStore } from "./store/chatUiStore";
import { useFocusUiStore } from "./store/focusUiStore";
import { usePrefsStore } from "./store/prefsStore";
import { useSidebarUiStore } from "./store/sidebarUiStore";
import { useSyncStore } from "./store/syncStore";
import { isFileTab, isSettingsTab, useVaultStore } from "./store/vaultStore";
import { useAutoSync } from "./hooks/useAutoSync";
import { getEmbeddingsIndexStatus } from "./lib/vaultApi";
import "./App.css";

function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tabs = useVaultStore((s) => s.tabs);
  const activePath = useVaultStore((s) => s.activePath);
  const content = useVaultStore((s) => s.content);
  const viewMode = useVaultStore((s) => s.viewMode);
  const error = useVaultStore((s) => s.error);
  const setContent = useVaultStore((s) => s.setContent);
  const toggleViewMode = useVaultStore((s) => s.toggleViewMode);
  const saveActive = useVaultStore((s) => s.saveActive);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const toggleSettings = usePrefsStore((s) => s.toggleSettings);
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
      if (!mod) return;

      const code = e.code;
      if (code === "KeyS") {
        e.preventDefault();
        void saveActive();
      }
      if (code === "KeyE") {
        e.preventDefault();
        const st = useVaultStore.getState();
        const path = st.activePath;
        if (!path) return;
        const tab = st.tabs.find((t) => t.path === path);
        if (tab && !isFileTab(tab)) return;
        const kind = documentKind(path);
        if (kind !== "markdown" && kind !== "mdlnks") return;
        toggleViewMode();
      }
      if (e.key === "," || code === "Comma") {
        e.preventDefault();
        toggleSettings();
      }
      if (e.shiftKey && code === "KeyL") {
        e.preventDefault();
        if (useFocusUiStore.getState().active) return;
        toggleChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, toggleViewMode, toggleSettings, toggleChat]);

  useEffect(() => {
    let unlistenJobs: (() => void) | undefined;
    void listen("background-job://update", (event) => {
      applyBackgroundJobPayload(event.payload);
    }).then((fn) => {
      unlistenJobs = fn;
    });
    void getEmbeddingsIndexStatus()
      .then((st) => {
        if (st.indexing) {
          applyBackgroundJobPayload({
            id: "embeddings-index",
            label: "Indexing notes",
            progress: st.progress,
            status: "running",
            detail: st.error ?? undefined,
          });
        } else if (st.error) {
          applyBackgroundJobPayload({
            id: "embeddings-index",
            label: "Indexing notes",
            progress: st.progress,
            status: "error",
            detail: st.error,
          });
        }
      })
      .catch(() => {
        /* embeddings optional at startup */
      });
    return () => {
      unlistenJobs?.();
    };
  }, []);

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
        // Keep pending paths — only defer until suppress window ends.
        debounceTimer = window.setTimeout(() => void flush(), 400);
        return;
      }

      const paths = [...pendingPaths];
      pendingPaths.clear();

      await refreshTree();
      void refreshSyncStatus();

      const mdPaths = paths.filter((p) => p.toLowerCase().endsWith(".md"));
      if (mdPaths.length === 1) {
        await useVaultStore.getState().reindexVaultNoteTags(mdPaths[0]!);
      } else if (mdPaths.length > 1) {
        // Several notes changed (sync/bulk) — patch each head, then read catalog.
        for (const p of mdPaths) {
          await useVaultStore.getState().reindexVaultNoteTags(p);
        }
      }

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
        useVaultStore.getState().applyExternalContent(current, next);
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

  const onEditorChange = (path: string, nextContent: string) => {
    // Each tab keeps its own mounted editor instance; accept input only
    // from the currently active tab to avoid cross-tab writes.
    if (useVaultStore.getState().activePath !== path) return;
    setContent(nextContent);
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
              {!vaultPath && tabs.length === 0 && (
                <div className="empty-state">
                  <h1>MarkSpace</h1>
                  <p>
                    Open a local folder as your vault. Notes are plain Markdown — editable here
                    or in VS Code / Cursor.
                  </p>
                </div>
              )}
              {(vaultPath || tabs.length > 0) && (
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
                      {(() => {
                        const activeTab = tabs.find(
                          (t) => t.path === activePath,
                        );
                        if (activeTab && !isFileTab(activeTab)) return null;
                        return (
                          (documentKind(activePath) === "markdown" ||
                            documentKind(activePath) === "mdlnks") &&
                          viewMode === "source" ? (
                            <DocumentToolbar
                              showOutlineToggle={
                                documentKind(activePath) === "markdown"
                              }
                            />
                          ) : null
                        );
                      })()}
                      <div className="document-body">
                        {tabs.map((tab) => {
                          const tabPath = tab.path;
                          const isActiveTab = tabPath === activePath;
                          const tabContent =
                            isActiveTab ? content : (tab.body ?? "");
                          if (isSettingsTab(tab)) {
                            return (
                              <div
                                key={tabPath}
                                className={
                                  isActiveTab
                                    ? "document-instance is-active"
                                    : "document-instance"
                                }
                                aria-hidden={!isActiveTab}
                              >
                                <SettingsPage onClose={closeSettings} />
                              </div>
                            );
                          }
                          if (!isFileTab(tab)) {
                            return (
                              <div
                                key={tabPath}
                                className={
                                  isActiveTab
                                    ? "document-instance document-instance-graph is-active"
                                    : "document-instance document-instance-graph"
                                }
                                aria-hidden={!isActiveTab}
                              >
                                {/* Keep mounted: WebGL survives visibility:hidden,
                                    but is lost under display:none. */}
                                <TagGraphView />
                              </div>
                            );
                          }
                          const kind = documentKind(tabPath);
                          return (
                            <div
                              key={tabPath}
                              className={
                                isActiveTab
                                  ? "document-instance is-active"
                                  : "document-instance"
                              }
                              aria-hidden={!isActiveTab}
                            >
                              {kind === "drawio" ? (
                                <DrawioEditor
                                  path={tabPath}
                                  content={tabContent}
                                  onChange={(xml) => onEditorChange(tabPath, xml)}
                                />
                              ) : kind === "mdlnks" ? (
                                <>
                                  <div
                                    className={
                                      viewMode === "live"
                                        ? "document-editor-slot is-active"
                                        : "document-editor-slot"
                                    }
                                  >
                                    <LinksEditor
                                      path={tabPath}
                                      content={tabContent}
                                      onChange={(next) =>
                                        onEditorChange(tabPath, next)
                                      }
                                    />
                                  </div>
                                  <div
                                    className={
                                      viewMode === "source"
                                        ? "document-editor-slot is-active"
                                        : "document-editor-slot"
                                    }
                                  >
                                    <div className="source-editor-wrap">
                                      <PlainSourceEditor
                                        path={tabPath}
                                        content={tabContent}
                                        onChange={(text) =>
                                          onEditorChange(tabPath, text)
                                        }
                                      />
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div
                                    className={
                                      viewMode === "live"
                                        ? "document-editor-slot is-active"
                                        : "document-editor-slot"
                                    }
                                  >
                                    <NoteEditor
                                      path={tabPath}
                                      content={tabContent}
                                      onChange={(markdown) =>
                                        onEditorChange(tabPath, markdown)
                                      }
                                    />
                                  </div>
                                  <div
                                    className={
                                      viewMode === "source"
                                        ? "document-editor-slot is-active"
                                        : "document-editor-slot"
                                    }
                                  >
                                    <div className="source-editor-wrap">
                                      <PageTags
                                        content={tabContent}
                                        onChange={(markdown) =>
                                          onEditorChange(tabPath, markdown)
                                        }
                                      />
                                      <MarkdownSourceEditor
                                        path={tabPath}
                                        content={tabContent}
                                        onChange={(markdown) =>
                                          onEditorChange(tabPath, markdown)
                                        }
                                      />
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
      <SelectionToChatButton />
    </div>
  );
}

export default App;

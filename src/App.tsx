import { memo, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
} from "react-resizable-panels";
import { Sidebar, loadLastVault } from "./components/Sidebar";
import { ChatSidebar } from "./components/chat/ChatSidebar";
import { SelectionToChatButton } from "./components/chat/SelectionToChatButton";
import {
  CommandPalette,
  type CommandPaletteMode,
} from "./components/CommandPalette";
import { ConfirmDialog } from "./components/AppDialog";
import { IeltsGeneralReviewDialog } from "./components/IeltsGeneralReviewDialog";
import { QuickTranslateDialog } from "./components/QuickTranslateDialog";
import { CaptureNoteDialog } from "./components/CaptureNoteDialog";
import { DocumentToolbar } from "./components/DocumentToolbar";
import { SettingsPage } from "./components/settings/SettingsPage";
import { StatusBar } from "./components/StatusBar";
import { ErrorToast } from "./components/ErrorToast";
import { SyncConflictBanner } from "./components/SyncConflictBanner";
import { EditorChrome } from "./components/TabBar";
import { UpdateBanner } from "./components/UpdateBanner";
import { NotePageChrome } from "./components/NotePageChrome";
import {
  MediaCatalogView,
  mediaCatalogFolderForPath,
} from "./components/MediaCatalogView";
import { TasksView } from "./components/TasksView";
import { TagGraphView } from "./components/graph/TagGraphView";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { PlainSourceEditor } from "./editor/PlainSourceEditor";
import { startAutoTagActiveNote } from "./ai/autoTagNote";
import { startSaveActiveNoteAsDocx } from "./lib/saveNoteDocx";
import { IELTS_REVIEW_MAX_CHARS } from "./ai/ieltsGeneralReview";
import {
  deleteCompletedTasksInActiveEditor,
  getActiveMarkdownSelection,
} from "./editor/completedTasksCommand";
import {
  closeDocumentFind,
  isActiveMarkdownFile,
  openDocumentFind,
  stepDocumentFind,
  subscribeDocumentFind,
} from "./editor/find/documentFindController";
import { NoteEditor } from "./editor/NoteEditor";
import { DrawioEditor } from "./editor/drawio/DrawioEditor";
import { LinksEditor } from "./editor/mdlnks/LinksEditor";
import { DictionaryEditor } from "./editor/mddict/DictionaryEditor";
import { HabitTrackerEditor } from "./editor/mdhabit/HabitTrackerEditor";
import { CourseTrackerEditor } from "./editor/mdcourse/CourseTrackerEditor";
import { DictPracticeDialog } from "./editor/mddict/DictPracticeDialog";
import { PdfViewer } from "./editor/pdf/PdfViewer";
import type { VaultChange } from "./lib/vaultApi";
import { documentKind, readNote } from "./lib/vaultApi";
import {
  loadShellLayout,
  saveShellLayout,
  toGroupLayout,
  type ShellLayout,
} from "./lib/shellLayout";
import {
  loadRecentCommands,
  pushRecentCommandId,
  saveRecentCommands,
} from "./lib/settingsStore";
import { useAiSettingsStore } from "./store/aiSettingsStore";
import { useMcpStore } from "./store/mcpStore";
import { applyBackgroundJobPayload } from "./store/backgroundJobsStore";
import { useChatUiStore } from "./store/chatUiStore";
import { useDocumentFindStore } from "./store/documentFindStore";
import { useFocusUiStore } from "./store/focusUiStore";
import { usePrefsStore } from "./store/prefsStore";
import { useSidebarUiStore } from "./store/sidebarUiStore";
import { useSyncStore } from "./store/syncStore";
import { useChatStore } from "./store/chatStore";
import { isFileTab, isGraphTab, isSettingsTab, isTasksTab, useVaultStore } from "./store/vaultStore";
import { openCaptureDialog } from "./store/captureStore";
import { useAutoSync } from "./hooks/useAutoSync";
import { useWarmLiveMarkdownPaths } from "./hooks/useWarmLiveMarkdownPaths";
import { getEmbeddingsIndexStatus } from "./lib/vaultApi";
import { pingUserActivity } from "./lib/userActivity";
import "./App.css";

/**
 * Virtual tab hosts — no vault editor `content` subscription so typing in a
 * note does not reconcile Tasks / Settings / Graph on every keystroke.
 */
const TasksDocumentTab = memo(function TasksDocumentTab({
  isActive,
}: {
  isActive: boolean;
}) {
  return (
    <div
      className={
        isActive ? "document-instance is-active" : "document-instance"
      }
      aria-hidden={!isActive}
      inert={!isActive}
    >
      {isActive ? <TasksView /> : null}
    </div>
  );
});

const SettingsDocumentTab = memo(function SettingsDocumentTab({
  isActive,
  onClose,
}: {
  isActive: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className={
        isActive ? "document-instance is-active" : "document-instance"
      }
      aria-hidden={!isActive}
      inert={!isActive}
    >
      <SettingsPage onClose={onClose} />
    </div>
  );
});

const GraphDocumentTab = memo(function GraphDocumentTab({
  isActive,
}: {
  isActive: boolean;
}) {
  return (
    <div
      className={
        isActive
          ? "document-instance document-instance-graph is-active"
          : "document-instance document-instance-graph"
      }
      aria-hidden={!isActive}
      inert={!isActive}
    >
      {/* Keep mounted: WebGL survives visibility:hidden,
          but is lost under display:none. */}
      <TagGraphView />
    </div>
  );
});

/**
 * Per-tab host: subscribes to its own content so typing the active note does
 * not reconcile keep-alive editors. Parent may re-render on tabs[]; memo bails.
 */
const DocumentTab = memo(function DocumentTab({
  path,
  isActive,
  keepLiveMounted,
  onEditorChange,
}: {
  path: string;
  isActive: boolean;
  /** LRU keep-alive for Live markdown (BlockNote). */
  keepLiveMounted: boolean;
  onEditorChange: (path: string, nextContent: string) => void;
}) {
  const content = useVaultStore((s) =>
    s.activePath === path
      ? s.content
      : (s.tabs.find((t) => t.path === path)?.body ?? ""),
  );
  // Inactive tabs stay on a warm Live instance; active tab uses its own viewMode.
  const viewMode = useVaultStore((s) =>
    isActive ? s.viewMode : "live",
  );
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const mediaCatalogFolder = mediaCatalogFolderForPath(
    path,
    projectPropertiesByPath,
  );

  const docKind = documentKind(path);
  const liveSlotActive = !isActive || viewMode === "live";

  if (mediaCatalogFolder != null) {
    return (
      <div
        className={
          isActive ? "document-instance is-active" : "document-instance"
        }
        aria-hidden={!isActive}
        inert={!isActive}
      >
        <MediaCatalogView folder={mediaCatalogFolder} />
      </div>
    );
  }

  return (
    <div
      className={
        isActive ? "document-instance is-active" : "document-instance"
      }
      aria-hidden={!isActive}
      inert={!isActive}
    >
      {docKind === "drawio" ? (
        <DrawioEditor
          path={path}
          content={content}
          isActive={isActive}
          onChange={(xml) => onEditorChange(path, xml)}
        />
      ) : docKind === "pdf" ? (
        <PdfViewer path={path} isActive={isActive} />
      ) : docKind === "mdlnks" ? (
        <>
          <div
            className={
              liveSlotActive
                ? "document-editor-slot is-active"
                : "document-editor-slot"
            }
          >
            <LinksEditor
              path={path}
              content={content}
              onChange={(next) => onEditorChange(path, next)}
            />
          </div>
          {isActive && viewMode === "source" ? (
            <div className="document-editor-slot is-active">
              <div className="source-editor-wrap">
                <PlainSourceEditor
                  path={path}
                  content={content}
                  onChange={(text) => onEditorChange(path, text)}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : docKind === "mddict" ? (
        <>
          <div
            className={
              liveSlotActive
                ? "document-editor-slot is-active"
                : "document-editor-slot"
            }
          >
            <DictionaryEditor
              path={path}
              content={content}
              onChange={(next) => onEditorChange(path, next)}
            />
          </div>
          {isActive && viewMode === "source" ? (
            <div className="document-editor-slot is-active">
              <div className="source-editor-wrap">
                <PlainSourceEditor
                  path={path}
                  content={content}
                  onChange={(text) => onEditorChange(path, text)}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : docKind === "mdhabit" ? (
        <>
          <div
            className={
              liveSlotActive
                ? "document-editor-slot is-active"
                : "document-editor-slot"
            }
          >
            <HabitTrackerEditor
              path={path}
              content={content}
              onChange={(next) => onEditorChange(path, next)}
            />
          </div>
          {isActive && viewMode === "source" ? (
            <div className="document-editor-slot is-active">
              <div className="source-editor-wrap">
                <PlainSourceEditor
                  path={path}
                  content={content}
                  onChange={(text) => onEditorChange(path, text)}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : docKind === "mdcourse" ? (
        <>
          <div
            className={
              liveSlotActive
                ? "document-editor-slot is-active"
                : "document-editor-slot"
            }
          >
            <CourseTrackerEditor
              path={path}
              content={content}
              onChange={(next) => onEditorChange(path, next)}
            />
          </div>
          {isActive && viewMode === "source" ? (
            <div className="document-editor-slot is-active">
              <div className="source-editor-wrap">
                <PlainSourceEditor
                  path={path}
                  content={content}
                  onChange={(text) => onEditorChange(path, text)}
                />
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div
            className={
              liveSlotActive
                ? "document-editor-slot is-active"
                : "document-editor-slot"
            }
          >
            {keepLiveMounted ? (
              <NoteEditor
                path={path}
                content={content}
                isActive={isActive}
                onChange={(markdown) => onEditorChange(path, markdown)}
              />
            ) : null}
          </div>
          {isActive && viewMode === "source" ? (
            <div className="document-editor-slot is-active">
              <div className="source-editor-wrap">
                <NotePageChrome
                  path={path}
                  content={content}
                  onChange={(markdown) => onEditorChange(path, markdown)}
                />
                <MarkdownSourceEditor
                  path={path}
                  content={content}
                  onChange={(markdown) => onEditorChange(path, markdown)}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
});

/**
 * Isolated from shell Panel re-renders during splitter drag so NoteEditor /
 * FileTree / chat are not reconciled every pointermove.
 */
const MainPane = memo(function MainPane({
  onEditorChange,
}: {
  onEditorChange: (path: string, nextContent: string) => void;
}) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const tabs = useVaultStore((s) => s.tabs);
  const activePath = useVaultStore((s) => s.activePath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const closeSettings = usePrefsStore((s) => s.closeSettings);
  const warmLivePaths = useWarmLiveMarkdownPaths(tabs, activePath);

  return (
    <main className="main-pane">
      <ErrorToast />
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
                  const activeTab = tabs.find((t) => t.path === activePath);
                  if (activeTab && !isFileTab(activeTab)) return null;
                  if (
                    mediaCatalogFolderForPath(
                      activePath,
                      projectPropertiesByPath,
                    ) != null
                  ) {
                    return null;
                  }
                  const kind = documentKind(activePath);
                  const showToolbar =
                    kind === "markdown" ||
                    kind === "mdlnks" ||
                    kind === "mddict" ||
                    kind === "mdhabit" ||
                    kind === "mdcourse";
                  // One toolbar above the editor slots — not inside Live keep-alive
                  // editors, or Source would stack a second path/Live/Source row
                  // over the warm Live chrome.
                  return showToolbar ? (
                    <DocumentToolbar
                      showOutlineToggle={kind === "markdown"}
                      showCommentsToggle={kind === "markdown"}
                    />
                  ) : null;
                })()}
                <div className="document-body">
                  {tabs.map((tab) => {
                    const isActive = tab.path === activePath;
                    if (isSettingsTab(tab)) {
                      return (
                        <SettingsDocumentTab
                          key={tab.path}
                          isActive={isActive}
                          onClose={closeSettings}
                        />
                      );
                    }
                    if (isGraphTab(tab)) {
                      return (
                        <GraphDocumentTab
                          key={tab.path}
                          isActive={isActive}
                        />
                      );
                    }
                    if (isTasksTab(tab)) {
                      return (
                        <TasksDocumentTab
                          key={tab.path}
                          isActive={isActive}
                        />
                      );
                    }
                    return (
                      <DocumentTab
                        key={tab.path}
                        path={tab.path}
                        isActive={isActive}
                        keepLiveMounted={
                          isActive || warmLivePaths.has(tab.path)
                        }
                        onEditorChange={onEditorChange}
                      />
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
  );
});

const PALETTE_COMMANDS = [
  {
    id: "capture-to-incoming",
    label: "Capture to Incoming",
    keywords: "inbox capture fleeting note thought scratch quick",
    shortcut: { mod: true, shift: true, key: "N" },
    opensOverlay: true,
  },
  {
    id: "auto-tag-note",
    label: "Auto-tag note",
    keywords: "tags tagging hashtag classify catalog frontmatter",
  },
  {
    id: "delete-completed-tasks",
    label: "Delete completed tasks",
    keywords: "checkbox checked done finished todo checklist remove",
  },
  {
    id: "open-word-trainer",
    label: "Open word trainer",
    keywords: "practice dictionary words mddict",
  },
  {
    id: "quick-translate",
    label: "Quick translation",
    keywords: "translate dictionary word lookup russian english grisha",
    shortcut: { mod: true, shift: true, key: "T" },
  },
  {
    id: "ielts-general-writing-review",
    label: "IELTS General writing review",
    keywords: "ielts gt general training writing band essay letter",
  },
  {
    id: "save-as-docx",
    label: "Save as Word",
    keywords: "export docx word document office",
  },
];

function resolvePracticeProjectPath(
  activePath: string | null,
  projectPropertiesByPath: Record<
    string,
    { projectType?: string }
  >,
): string | null {
  if (activePath) {
    const project = activePath.split("/")[0] ?? "";
    if (
      project &&
      projectPropertiesByPath[project]?.projectType === "languageLearning"
    ) {
      return project;
    }
  }
  const learning = Object.entries(projectPropertiesByPath)
    .filter(([, p]) => p.projectType === "languageLearning")
    .map(([path]) => path)
    .sort();
  return learning[0] ?? null;
}

function openCaptureFromEditorContext(): void {
  const selected = getActiveMarkdownSelection().replace(/\s+/g, " ").trim();
  const activePath = useVaultStore.getState().activePath;
  openCaptureDialog({
    quote: selected || undefined,
    sourcePath: activePath ?? undefined,
  });
}

/** Idle time before writing the active note to disk (and kicking off index work). */
const AUTOSAVE_MS = 5_000;

/** Edge strip width that reveals a collapsed shell panel as an overlay. */
const SHELL_PEEK_EDGE_PX = 20;
const SHELL_PEEK_HIDE_MS = 180;

type ShellPeekSide = "sidebar" | "chat";

function clampPeekWidth(percent: number, total: number, min: number, max: number) {
  const fromPct = Math.round((percent / 100) * total);
  return Math.min(max, Math.max(min, fromPct));
}

function shouldKeepShellPeek(side: ShellPeekSide, x: number, y: number): boolean {
  if (document.querySelector(".tree-context-menu")) return true;
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  if (el.closest(`[data-shell-peek="${side}"]`)) return true;
  if (el.closest(".tree-context-menu")) return true;
  if (el.closest('[role="dialog"]')) return true;
  if (el.closest(".command-palette-root")) return true;
  if (el.closest(".ms-select-menu")) return true;
  return false;
}

function App() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const setContent = useVaultStore((s) => s.setContent);
  const toggleViewMode = useVaultStore((s) => s.toggleViewMode);
  const saveActive = useVaultStore((s) => s.saveActive);
  const openVaultAt = useVaultStore((s) => s.openVaultAt);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const toggleSettings = usePrefsStore((s) => s.toggleSettings);
  const hydratePrefs = usePrefsStore((s) => s.hydrate);
  const hydrateAi = useAiSettingsStore((s) => s.hydrate);
  const hydrateMcp = useMcpStore((s) => s.hydrate);
  const hydrateMcpVault = useMcpStore((s) => s.hydrateForVault);
  const mcpHydrated = useMcpStore((s) => s.hydrated);
  const refreshSyncStatus = useSyncStore((s) => s.refreshStatus);
  const sidebarOpen = useSidebarUiStore((s) => s.open);
  const chatOpen = useChatUiStore((s) => s.open);
  const toggleChat = useChatUiStore((s) => s.toggle);
  const sidebarSizePercent = useSidebarUiStore((s) => s.lastSizePercent);
  const chatSizePercent = useChatUiStore((s) => s.lastSizePercent);
  const tree = useVaultStore((s) => s.tree);
  const recentPaths = useVaultStore((s) => s.recentPaths);
  const openNote = useVaultStore((s) => s.openNote);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] =
    useState<CommandPaletteMode>("files");
  const [recentCommandIds, setRecentCommandIds] = useState<string[]>([]);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceProjectPath, setPracticeProjectPath] = useState("");
  const [practiceBlockedOpen, setPracticeBlockedOpen] = useState(false);
  const [quickTranslateOpen, setQuickTranslateOpen] = useState(false);
  const [quickTranslateQuery, setQuickTranslateQuery] = useState("");
  const [ieltsReviewOpen, setIeltsReviewOpen] = useState(false);
  const [ieltsReviewQuery, setIeltsReviewQuery] = useState("");
  const timer = useRef<number | null>(null);
  const groupRef = useGroupRef();
  const applyingRef = useRef(false);
  const savedRef = useRef<ShellLayout>(loadShellLayout());
  const panelsFrameRef = useRef<HTMLDivElement>(null);
  const peekHideTimers = useRef<{
    sidebar: number | null;
    chat: number | null;
  }>({ sidebar: null, chat: null });
  const pointerPos = useRef({ x: 0, y: 0 });
  const [sidebarPeeking, setSidebarPeeking] = useState(false);
  const [chatPeeking, setChatPeeking] = useState(false);
  const [peekWidths, setPeekWidths] = useState(() => {
    const total =
      typeof window !== "undefined" ? window.innerWidth : 1200;
    const layout = loadShellLayout();
    return {
      sidebar: clampPeekWidth(layout.sidebar, total, 200, 480),
      chat: clampPeekWidth(layout.chat, total, 280, 800),
    };
  });
  const initialLayout = toGroupLayout(savedRef.current, chatOpen, sidebarOpen);

  const clearPeekHide = useCallback((side?: ShellPeekSide) => {
    if (side) {
      const id = peekHideTimers.current[side];
      if (id != null) {
        window.clearTimeout(id);
        peekHideTimers.current[side] = null;
      }
      return;
    }
    for (const key of ["sidebar", "chat"] as const) {
      const id = peekHideTimers.current[key];
      if (id != null) {
        window.clearTimeout(id);
        peekHideTimers.current[key] = null;
      }
    }
  }, []);

  const showPeek = useCallback(
    (side: ShellPeekSide) => {
      clearPeekHide(side);
      if (side === "sidebar") setSidebarPeeking(true);
      else setChatPeeking(true);
    },
    [clearPeekHide],
  );

  const scheduleHidePeek = useCallback(
    (side: ShellPeekSide) => {
      clearPeekHide(side);
      peekHideTimers.current[side] = window.setTimeout(() => {
        peekHideTimers.current[side] = null;
        if (shouldKeepShellPeek(side, pointerPos.current.x, pointerPos.current.y)) {
          scheduleHidePeek(side);
          return;
        }
        if (side === "sidebar") setSidebarPeeking(false);
        else setChatPeeking(false);
      }, SHELL_PEEK_HIDE_MS);
    },
    [clearPeekHide],
  );

  useAutoSync();

  useEffect(() => {
    if (sidebarOpen) {
      clearPeekHide("sidebar");
      setSidebarPeeking(false);
    }
  }, [sidebarOpen, clearPeekHide]);

  useEffect(() => {
    if (chatOpen) {
      clearPeekHide("chat");
      setChatPeeking(false);
    }
  }, [chatOpen, clearPeekHide]);

  useEffect(() => {
    const updateWidths = () => {
      const total =
        panelsFrameRef.current?.clientWidth || window.innerWidth;
      const layout = savedRef.current;
      setPeekWidths({
        sidebar: clampPeekWidth(
          sidebarSizePercent || layout.sidebar,
          total,
          200,
          480,
        ),
        chat: clampPeekWidth(chatSizePercent || layout.chat, total, 280, 800),
      });
    };
    updateWidths();
    const el = panelsFrameRef.current;
    const ro =
      typeof ResizeObserver !== "undefined" && el
        ? new ResizeObserver(updateWidths)
        : null;
    ro?.observe(el!);
    window.addEventListener("resize", updateWidths);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateWidths);
    };
  }, [sidebarSizePercent, chatSizePercent, sidebarPeeking, chatPeeking]);

  useEffect(() => {
    if (!sidebarPeeking && !chatPeeking) return;
    const onMove = (e: PointerEvent) => {
      pointerPos.current = { x: e.clientX, y: e.clientY };
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearPeekHide();
      setSidebarPeeking(false);
      setChatPeeking(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [sidebarPeeking, chatPeeking, clearPeekHide]);

  useEffect(() => {
    return () => clearPeekHide();
  }, [clearPeekHide]);

  useEffect(() => {
    void hydratePrefs();
    void hydrateAi();
    void hydrateMcp();
    void loadRecentCommands().then(setRecentCommandIds);
  }, [hydratePrefs, hydrateAi, hydrateMcp]);

  useEffect(() => {
    if (!mcpHydrated) return;
    void hydrateMcpVault(vaultPath);
  }, [vaultPath, mcpHydrated, hydrateMcpVault]);

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

  useEffect(() => subscribeDocumentFind(), []);

  useEffect(() => {
    const modalOpen = () =>
      Boolean(
        document.querySelector(".command-palette-root, [role='dialog']"),
      );

    const onFindKey = (e: KeyboardEvent) => {
      if (paletteOpen || modalOpen()) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyF" && !e.shiftKey && !e.altKey) {
        if (!isActiveMarkdownFile()) return;
        e.preventDefault();
        e.stopPropagation();
        openDocumentFind();
        return;
      }
      if (e.code === "F3" && !mod && !e.altKey) {
        if (!isActiveMarkdownFile()) return;
        e.preventDefault();
        e.stopPropagation();
        stepDocumentFind(e.shiftKey ? -1 : 1);
      }
    };

    const onFindEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (paletteOpen || modalOpen()) return;
      if (!useDocumentFindStore.getState().open) return;
      e.preventDefault();
      closeDocumentFind();
    };

    window.addEventListener("keydown", onFindKey, true);
    window.addEventListener("keydown", onFindEsc);
    return () => {
      window.removeEventListener("keydown", onFindKey, true);
      window.removeEventListener("keydown", onFindEsc);
    };
  }, [paletteOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          void useVaultStore.getState().goBack();
          return;
        }
        if (e.code === "ArrowRight") {
          e.preventDefault();
          void useVaultStore.getState().goForward();
          return;
        }
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const code = e.code;
      if (code === "KeyP") {
        if (!vaultPath) return;
        e.preventDefault();
        setPaletteMode(e.shiftKey ? "commands" : "files");
        setPaletteOpen(true);
        return;
      }
      if (code === "KeyW" && !e.shiftKey) {
        const path = useVaultStore.getState().activePath;
        if (!path) return;
        e.preventDefault();
        void useVaultStore.getState().closeTab(path);
        return;
      }
      if (code === "KeyS") {
        e.preventDefault();
        if (timer.current) {
          window.clearTimeout(timer.current);
          timer.current = null;
        }
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
        if (kind !== "markdown" && kind !== "mdlnks" && kind !== "mddict" && kind !== "mdhabit" && kind !== "mdcourse") return;
        toggleViewMode();
      }
      if (e.key === "," || code === "Comma") {
        e.preventDefault();
        toggleSettings();
      }
      if (e.shiftKey && code === "KeyL") {
        e.preventDefault();
        if (useFocusUiStore.getState().active) {
          useFocusUiStore.getState().deactivate();
          useChatUiStore.getState().setOpen(true);
          return;
        }
        toggleChat();
      }
      if (e.shiftKey && code === "KeyT") {
        if (!vaultPath) return;
        e.preventDefault();
        const selected = getActiveMarkdownSelection()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        setQuickTranslateQuery(selected);
        setQuickTranslateOpen(true);
      }
      if (e.shiftKey && code === "KeyN") {
        if (!vaultPath) return;
        e.preventDefault();
        openCaptureFromEditorContext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive, toggleViewMode, toggleSettings, toggleChat, vaultPath]);

  const runPaletteCommand = useCallback(
    (id: string) => {
      if (id === "capture-to-incoming") {
        openCaptureFromEditorContext();
        return;
      }
      if (id === "auto-tag-note") {
        startAutoTagActiveNote();
        return;
      }
      if (id === "delete-completed-tasks") {
        deleteCompletedTasksInActiveEditor();
        return;
      }
      if (id === "quick-translate") {
        const selected = getActiveMarkdownSelection()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        setQuickTranslateQuery(selected);
        setQuickTranslateOpen(true);
        return;
      }
      if (id === "ielts-general-writing-review") {
        const selected = getActiveMarkdownSelection()
          .trim()
          .slice(0, IELTS_REVIEW_MAX_CHARS);
        setIeltsReviewQuery(selected);
        setIeltsReviewOpen(true);
        return;
      }
      if (id === "save-as-docx") {
        startSaveActiveNoteAsDocx();
        return;
      }
      if (id !== "open-word-trainer") return;
      const project = resolvePracticeProjectPath(
        useVaultStore.getState().activePath,
        useVaultStore.getState().projectPropertiesByPath,
      );
      if (!project) {
        setPracticeBlockedOpen(true);
        return;
      }
      setPracticeProjectPath(project);
      setPracticeOpen(true);
    },
    [],
  );

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

  // One place to notice the user working, so background indexing can step
  // aside. Passive + capture so nothing here can delay or swallow input.
  useEffect(() => {
    const onActivity = () => pingUserActivity();
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("keydown", onActivity, opts);
    document.addEventListener("pointerdown", onActivity, opts);
    document.addEventListener("wheel", onActivity, opts);
    return () => {
      document.removeEventListener("keydown", onActivity, opts);
      document.removeEventListener("pointerdown", onActivity, opts);
      document.removeEventListener("wheel", onActivity, opts);
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

      const tagPaths = paths.filter((p) => {
        const lower = p.toLowerCase();
        return lower.endsWith(".md") || lower.endsWith(".pdf");
      });
      if (tagPaths.length === 1) {
        await useVaultStore.getState().reindexVaultNoteTags(tagPaths[0]!);
      } else if (tagPaths.length > 1) {
        for (const p of tagPaths) {
          await useVaultStore.getState().reindexVaultNoteTags(p);
        }
      }

      if (paths.some((p) => p.toLowerCase().endsWith(".mddict"))) {
        void useVaultStore.getState().refreshDictionaryTags();
      }

      const { activePath: current, dirty } = useVaultStore.getState();
      if (!current || dirty) return;
      if (documentKind(current) === "pdf") return;
      const hit = paths.some(
        (path) =>
          path === current ||
          path.endsWith(`/${current}`) ||
          current.endsWith(path),
      );
      if (!hit) return;
      try {
        const next = await readNote(current);
        // Re-check after await: typing during readNote must win over disk echo.
        const latest = useVaultStore.getState();
        if (latest.activePath !== current || latest.dirty) return;
        if (latest.content === next) return;
        latest.applyExternalContent(current, next);
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

  // Flush note autosave and the active chat thread when the window is hidden
  // or closed so streaming / unsaved editor state is not left only in memory.
  useEffect(() => {
    const clearTimer = () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const flush = async () => {
      clearTimer();
      await Promise.all([
        saveActive(),
        useChatStore.getState().persistActive(),
      ]);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let unlistenClose: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async () => {
        await flush();
      })
      .then((fn) => {
        unlistenClose = fn;
      })
      .catch(() => {
        /* non-Tauri / missing window permission — visibility flush remains */
      });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unlistenClose?.();
    };
  }, [saveActive]);

  const onEditorChange = useCallback(
    (path: string, nextContent: string) => {
      // Each tab keeps its own mounted editor instance; accept input only
      // from the currently active tab to avoid cross-tab writes.
      if (useVaultStore.getState().activePath !== path) return;
      setContent(nextContent);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void saveActive();
      }, AUTOSAVE_MS);
    },
    [setContent, saveActive],
  );

  const panelClass = [
    "app-panels",
    sidebarOpen ? "" : "is-sidebar-collapsed",
    chatOpen ? "" : "is-chat-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  const frameStyle = {
    ["--peek-sidebar-width" as string]: `${peekWidths.sidebar}px`,
    ["--peek-chat-width" as string]: `${peekWidths.chat}px`,
  };

  return (
    <div className="app-shell">
      <UpdateBanner />
      <div className="app-panels-frame" ref={panelsFrameRef} style={frameStyle}>
        {!sidebarOpen && (
          <div
            className="shell-edge-hit shell-edge-hit-left"
            data-shell-peek="sidebar"
            style={{ width: SHELL_PEEK_EDGE_PX }}
            onPointerEnter={() => showPeek("sidebar")}
            onPointerLeave={() => scheduleHidePeek("sidebar")}
          />
        )}
        {!chatOpen && (
          <div
            className="shell-edge-hit shell-edge-hit-right"
            data-shell-peek="chat"
            style={{ width: SHELL_PEEK_EDGE_PX }}
            onPointerEnter={() => showPeek("chat")}
            onPointerLeave={() => scheduleHidePeek("chat")}
          />
        )}
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
            data-shell-peek="sidebar"
            data-peeking={sidebarPeeking || undefined}
            collapsible
            collapsedSize={0}
            defaultSize={`${initialLayout.sidebar}%`}
            minSize={200}
            maxSize={480}
            groupResizeBehavior="preserve-pixel-size"
            onPointerEnter={() => {
              if (!sidebarOpen && sidebarPeeking) showPeek("sidebar");
            }}
            onPointerLeave={() => {
              if (!sidebarOpen && sidebarPeeking) scheduleHidePeek("sidebar");
            }}
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
            <MainPane onEditorChange={onEditorChange} />
          </Panel>

          <Separator
            className="app-splitter app-splitter-chat"
            disabled={!chatOpen}
          />

          <Panel
            id="chat"
            className="chat-panel-host"
            data-shell-peek="chat"
            data-peeking={chatPeeking || undefined}
            collapsible
            collapsedSize={0}
            defaultSize={`${initialLayout.chat}%`}
            minSize={280}
            maxSize={800}
            groupResizeBehavior="preserve-pixel-size"
            onPointerEnter={() => {
              if (!chatOpen && chatPeeking) showPeek("chat");
            }}
            onPointerLeave={() => {
              if (!chatOpen && chatPeeking) scheduleHidePeek("chat");
            }}
          >
            <ChatSidebar />
          </Panel>
        </Group>
      </div>
      <SelectionToChatButton />
      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        tree={tree}
        recentPaths={recentPaths}
        commands={PALETTE_COMMANDS}
        recentCommandIds={recentCommandIds}
        onClose={() => setPaletteOpen(false)}
        onOpenFile={(path) => {
          void openNote(path, { preview: true });
        }}
        onRunCommand={(id) => {
          setRecentCommandIds((prev) => {
            const next = pushRecentCommandId(prev, id);
            void saveRecentCommands(next);
            return next;
          });
          runPaletteCommand(id);
        }}
      />
      <DictPracticeDialog
        open={practiceOpen}
        projectPath={practiceProjectPath}
        tree={tree}
        onClose={() => setPracticeOpen(false)}
      />
      <QuickTranslateDialog
        open={quickTranslateOpen}
        initialQuery={quickTranslateQuery}
        onClose={() => setQuickTranslateOpen(false)}
      />
      <CaptureNoteDialog />
      <IeltsGeneralReviewDialog
        open={ieltsReviewOpen}
        initialText={ieltsReviewQuery}
        onClose={() => setIeltsReviewOpen(false)}
      />
      <ConfirmDialog
        open={practiceBlockedOpen}
        title="Word trainer"
        description="Practice is available in language-learning projects. Set a project type to Foreign language learning in Project properties."
        confirmLabel="OK"
        danger={false}
        onCancel={() => setPracticeBlockedOpen(false)}
        onConfirm={() => setPracticeBlockedOpen(false)}
      />
    </div>
  );
}

export default App;

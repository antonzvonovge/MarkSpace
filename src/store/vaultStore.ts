import { create } from "zustand";
import { skillTemplate } from "../ai/skills";
import type { TreeNode } from "../lib/vaultApi";
import {
  addFavorite,
  createDrawio,
  createFolder,
  createMddict,
  createMdlnks,
  createNote,
  deleteNoteComment,
  deletePath,
  documentKind,
  ensureFolderNote,
  folderPathFromFolderNote,
  importDocumentBytes,
  importPaths,
  isFolderNotePath,
  isPdfPath,
  isSkillsFolder,
  isValidSkillId,
  joinPath,
  listAllComments,
  listDictionaryTags,
  listFavorites,
  listNoteComments,
  listProjectProperties,
  listTree,
  listVaultTags,
  moveEntry,
  nestUnderNote,
  openVault,
  parentPath,
  readNote,
  reindexNoteTags as reindexNoteTagsApi,
  removeFavorite,
  renamePath,
  setCommentResolved,
  skillPathForId,
  upsertNoteComment,
  writeNote,
  type CommentRef,
  type NoteComment,
  type ProjectProperties,
  type UpsertCommentInput,
} from "../lib/vaultApi";
import {
  loadExpandedPaths,
  saveExpandedPaths,
  loadVaultSession,
  saveVaultSession,
} from "../lib/settingsStore";
import { arrayMove } from "../lib/arrayMove";
import {
  loadDocOutlineUi,
  saveDocOutlineOpen,
} from "../lib/outlineUiState";
import {
  loadDocCommentsUi,
  saveDocCommentsOpen,
} from "../lib/commentsUiState";
import {
  dailyNotePath,
  diaryProjectRootForPath,
} from "../lib/diaryNotes";
import { getNoteTags, setNoteTags } from "../lib/noteFrontmatter";

/** Coalesce UI tag-catalog refreshes after rapid saves. */
const TAG_CATALOG_REFRESH_MS = 1_500;
let tagCatalogRefreshTimer: number | null = null;

function scheduleTagCatalogRefresh(refresh: () => Promise<void>) {
  if (tagCatalogRefreshTimer != null) {
    window.clearTimeout(tagCatalogRefreshTimer);
  }
  tagCatalogRefreshTimer = window.setTimeout(() => {
    tagCatalogRefreshTimer = null;
    void refresh();
  }, TAG_CATALOG_REFRESH_MS);
}

export type TabKind = "file" | "graph" | "settings";

/** Singleton virtual path for the tag graph tab (never a vault-relative file). */
export const GRAPH_TAB_PATH = "markspace:graph";

/** Singleton virtual path for the settings tab. */
export const SETTINGS_TAB_PATH = "markspace:settings";

export type EditorTab = {
  path: string;
  kind: TabKind;
  preview: boolean;
  /**
   * In-memory copy while the tab is open. Absent until first load.
   * Keeps tab switches instant (no disk re-read).
   */
  body?: string;
  dirty?: boolean;
};

export type ViewMode = "live" | "source";

type OpenNoteOptions = {
  /** VS Code preview mode — default true */
  preview?: boolean;
  /**
   * When false, keep the file tree without a selected/active row
   * (used when restoring a vault session on app open).
   */
  syncTreeSelection?: boolean;
  /** 1-based page to jump to when opening a PDF. */
  page?: number;
};

type VaultStore = {
  vaultPath: string | null;
  tree: TreeNode | null;
  tabs: EditorTab[];
  activePath: string | null;
  selectedFolderPath: string;
  /** True only after the user clicks a folder in the tree (not when opening a note). */
  selectedFolderExplicit: boolean;
  /**
   * When false, the tree shows no selected/active highlight
   * (e.g. right after session restore).
   */
  treeSelectionVisible: boolean;
  expandedPaths: string[];
  /** Vault-relative favorite paths (pages and folders), sorted. */
  favoritePaths: string[];
  /** Project properties keyed by project path (first-level folder). */
  projectPropertiesByPath: Record<string, ProjectProperties>;
  /** All vault comments for the sidebar inbox (project → note tree). */
  allComments: CommentRef[];
  /** Comments for the active note (Live panel). */
  activeNoteComments: NoteComment[];
  /** Live-mode document outline (TOC) pane. */
  showOutline: boolean;
  /** Live-mode comments pane. */
  showComments: boolean;
  /** Focus a comment after openNote (from sidebar inbox). */
  pendingCommentFocusId: string | null;
  /** Unique tags from note frontmatter and inline `#tags` across the vault. */
  vaultTags: string[];
  /** Unique tags from all `.mddict` files (separate bank; not in tag graph). */
  dictionaryTags: string[];
  content: string;
  viewMode: ViewMode;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string | null;
  /** 1-based page requested when opening a PDF; consumed by PdfViewer. */
  pendingPdfPage: number | null;
  suppressWatchUntil: number;
  openVaultAt: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  refreshVaultTags: () => Promise<void>;
  /** Reload dictionary tag bank from all `.mddict` files. */
  refreshDictionaryTags: () => Promise<void>;
  /** Reload `.markspace/projects` markers into `projectPropertiesByPath`. */
  refreshProjectProperties: () => Promise<void>;
  /** Upsert one project's properties in the in-memory map (after dialog save). */
  upsertProjectProperties: (props: ProjectProperties) => void;
  /** Patch in-memory tag index for one note after an external edit. */
  reindexVaultNoteTags: (path: string) => Promise<void>;
  openNote: (path: string, options?: OpenNoteOptions) => Promise<void>;
  /** Take and clear a pending PDF page jump (1-based), if any. */
  takePendingPdfPage: () => number | null;
  /** Open (or focus) the singleton tag graph tab. */
  openGraphTab: (options?: { syncTreeSelection?: boolean }) => Promise<void>;
  /** Open (or focus) the singleton settings tab. */
  openSettingsTab: (options?: { syncTreeSelection?: boolean }) => Promise<void>;
  pinTab: (path: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  closeTab: (path: string) => Promise<void>;
  closeOtherTabs: (path: string) => Promise<void>;
  closeTabsToTheRight: (path: string) => Promise<void>;
  setContent: (content: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  toggleOutline: () => void;
  toggleComments: () => void;
  /** Reload vault-wide comments inbox. */
  refreshAllComments: () => Promise<void>;
  /** Load comments for the active note into `activeNoteComments`. */
  loadActiveNoteComments: () => Promise<void>;
  upsertActiveComment: (input: UpsertCommentInput) => Promise<NoteComment | null>;
  deleteActiveComment: (id: string) => Promise<void>;
  setActiveCommentResolved: (
    id: string,
    resolved: boolean,
  ) => Promise<void>;
  /** Open note and focus a comment in the Live panel. */
  openComment: (notePath: string, commentId: string) => Promise<void>;
  takePendingCommentFocus: () => string | null;
  saveActive: () => Promise<void>;
  selectFolder: (path: string) => void;
  /**
   * Select a folder and open its hidden overview note (`{folder}/.folder.md`),
   * creating the note when missing. No-op for vault root (`""`).
   */
  openOrCreateFolderNote: (folder: string) => Promise<void>;
  toggleExpanded: (path: string) => void;
  /** Collapse every folder under the vault root (vault itself stays open). */
  collapseAllFolders: () => void;
  isExpanded: (path: string) => boolean;
  isFavorite: (path: string) => boolean;
  addToFavorites: (path: string) => Promise<void>;
  removeFromFavorites: (path: string) => Promise<void>;
  createNoteInSelection: (name: string) => Promise<void>;
  createDrawioInSelection: (name: string) => Promise<void>;
  createMdlnksInSelection: (name: string) => Promise<void>;
  createMddictInSelection: (name: string) => Promise<void>;
  createFolderInSelection: (name: string) => Promise<void>;
  /**
   * Open a daily note under a diary project, creating
   * `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` when missing.
   * `fromPath` may be the project root or any path under it.
   * Defaults to today when `date` is omitted.
   * Pass `{ preview: true }` for VS Code-style preview tabs (e.g. calendar browse).
   */
  openOrCreateDailyNote: (
    fromPath: string,
    date?: Date,
    options?: { preview?: boolean },
  ) => Promise<{ path: string; created: boolean } | null>;
  /** Create Skills/<id>.md with skill frontmatter template. */
  createSkill: (id: string) => Promise<void>;
  moveTreeEntry: (
    from: string,
    toParent: string,
    toIndex: number,
  ) => Promise<string | null>;
  /**
   * Drop onto a markdown note: promote the note to a folder (`.folder.md`)
   * and move `from` into it.
   */
  nestTreeEntryUnderNote: (
    from: string,
    notePath: string,
    toIndex?: number,
  ) => Promise<string | null>;
  renameTreeEntry: (from: string, nextName: string) => Promise<void>;
  removePath: (path: string) => Promise<boolean>;
  /** Import OS paths / file blobs into the selected folder. */
  importIntoSelection: (
    sources: string[],
    files?: File[],
  ) => Promise<string[]>;
  /** Suppress vault-change handling for `ms` (default 1200). */
  markExternalWrite: (ms?: number) => void;
  /**
   * Replace the suppress window with exactly `now + ms` (does not extend via max).
   * Used after sync so intentional reloads are not followed by a long quiet period.
   */
  settleExternalWrite: (ms?: number) => void;
  /** Apply disk/tool content to an open tab (and the editor if active). */
  applyExternalContent: (path: string, content: string) => void;
  /**
   * Re-read clean open file tabs from disk (e.g. after git sync).
   * Skips dirty tabs and PDFs; no-ops when content is unchanged.
   */
  reloadOpenTabsFromDisk: () => Promise<void>;
};

export function isGraphTab(tab: Pick<EditorTab, "kind" | "path">): boolean {
  return tab.kind === "graph" || tab.path === GRAPH_TAB_PATH;
}

export function isSettingsTab(tab: Pick<EditorTab, "kind" | "path">): boolean {
  return tab.kind === "settings" || tab.path === SETTINGS_TAB_PATH;
}

/** Tabs backed by app UI instead of a vault file (graph, settings). */
export function isVirtualTab(tab: Pick<EditorTab, "kind" | "path">): boolean {
  return isGraphTab(tab) || isSettingsTab(tab);
}

export function isFileTab(tab: Pick<EditorTab, "kind" | "path">): boolean {
  return !isVirtualTab(tab);
}

async function loadFavoritePaths(): Promise<string[]> {
  try {
    return await listFavorites();
  } catch {
    return [];
  }
}

async function loadProjectPropertiesMap(): Promise<
  Record<string, ProjectProperties>
> {
  try {
    const list = await listProjectProperties();
    const map: Record<string, ProjectProperties> = {};
    for (const props of list) {
      map[props.path] = props;
    }
    return map;
  } catch {
    return {};
  }
}

function remapExpanded(expanded: string[], from: string, to: string): string[] {
  return expanded.map((p) => {
    if (p === from) return to;
    if (p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`;
    return p;
  });
}

function remapTabs(tabs: EditorTab[], from: string, to: string): EditorTab[] {
  return tabs.map((tab) => {
    if (isVirtualTab(tab)) return tab;
    if (tab.path === from) return { ...tab, path: to };
    if (tab.path.startsWith(`${from}/`)) {
      return { ...tab, path: `${to}${tab.path.slice(from.length)}` };
    }
    return tab;
  });
}

function withTabBody(
  tabs: EditorTab[],
  path: string,
  body: string,
  dirty: boolean,
): EditorTab[] {
  return tabs.map((t) => (t.path === path ? { ...t, body, dirty } : t));
}

/** Write the active editor buffer back into its tab slot. */
function stashActiveIntoTabs(
  tabs: EditorTab[],
  activePath: string | null,
  content: string,
  dirty: boolean,
): EditorTab[] {
  if (!activePath) return tabs;
  const active = tabs.find((t) => t.path === activePath);
  if (!active || isVirtualTab(active)) return tabs;
  return withTabBody(tabs, activePath, content, dirty);
}

function tabLabel(path: string, kind?: TabKind): string {
  if (kind === "graph" || path === GRAPH_TAB_PATH) return "Graph";
  if (kind === "settings" || path === SETTINGS_TAB_PATH) return "Settings";
  if (isFolderNotePath(path)) {
    const folder = parentPath(path);
    return folder.split("/").pop() || folder || "Folder";
  }
  const name = path.split("/").pop() ?? path;
  return name
    .replace(/\.md$/i, "")
    .replace(/\.drawio$/i, "")
    .replace(/\.mdlnks$/i, "")
    .replace(/\.mddict$/i, "")
    .replace(/\.pdf$/i, "");
}

/** Tree highlight after opening a note (folder notes keep the folder selected). */
function treeSelectionForOpen(path: string): {
  selectedFolderPath: string;
  selectedFolderExplicit: boolean;
  treeSelectionVisible: true;
} {
  return {
    selectedFolderPath: parentPath(path),
    selectedFolderExplicit: isFolderNotePath(path),
    treeSelectionVisible: true,
  };
}

function collectFilePaths(node: TreeNode, out: string[] = []): string[] {
  if (!node.isDir && node.path) out.push(node.path);
  for (const child of node.children ?? []) collectFilePaths(child, out);
  return out;
}

function collectDirPaths(node: TreeNode, out: string[] = []): string[] {
  if (node.isDir && node.path) out.push(node.path);
  for (const child of node.children ?? []) collectDirPaths(child, out);
  return out;
}

/**
 * Hidden folder notes (`.folder.md`) are omitted from `list_tree`, so they never
 * appear in `collectFilePaths`. Keep their tabs while the parent folder remains.
 */
function tabPathExistsInTree(
  path: string,
  files: Set<string>,
  dirs: Set<string>,
): boolean {
  if (files.has(path)) return true;
  if (!isFolderNotePath(path)) return false;
  const folder = folderPathFromFolderNote(path);
  return folder != null && dirs.has(folder);
}

function persistSession(state: {
  vaultPath: string | null;
  tabs: EditorTab[];
  activePath: string | null;
}) {
  if (!state.vaultPath) return;
  void saveVaultSession(state.vaultPath, {
    tabs: state.tabs.map((t) => ({
      path: t.path,
      preview: t.preview,
      kind: t.kind,
    })),
    activePath: state.activePath,
  });
}

function activateLoaded(
  set: (partial: Partial<VaultStore>) => void,
  vaultPath: string | null,
  path: string,
  content: string,
  tabs: EditorTab[],
  dirty = false,
  syncTreeSelection = true,
) {
  const outline = loadDocOutlineUi(vaultPath, path);
  const commentsUi = loadDocCommentsUi(vaultPath, path);
  set({
    tabs: withTabBody(tabs, path, content, dirty),
    activePath: path,
    content,
    dirty,
    loading: false,
    ...(syncTreeSelection
      ? treeSelectionForOpen(path)
      : { treeSelectionVisible: false }),
    showOutline: outline.open,
    showComments: commentsUi.open,
  });
}

/** Activate a non-file tab (graph, settings) without reading disk or touching the editor buffer. */
function activateVirtualTab(
  set: (partial: Partial<VaultStore>) => void,
  path: string,
  tabs: EditorTab[],
  syncTreeSelection = true,
) {
  set({
    tabs,
    activePath: path,
    content: "",
    dirty: false,
    loading: false,
    selectedFolderExplicit: false,
    ...(syncTreeSelection ? { treeSelectionVisible: true } : { treeSelectionVisible: false }),
    showOutline: false,
    showComments: false,
    activeNoteComments: [],
  });
}

async function activateTab(
  set: (partial: Partial<VaultStore>) => void,
  get: () => VaultStore,
  tab: EditorTab,
  tabs: EditorTab[],
): Promise<void> {
  if (isVirtualTab(tab)) {
    activateVirtualTab(set, tab.path, tabs);
    return;
  }
  // Prefer disk when clean so external restores (git/sync) are not masked by
  // a stale in-memory body. If dirty but disk is much larger, treat disk as a
  // restore and drop the truncated buffer.
  if (!isPdfPath(tab.path)) {
    try {
      const disk = await readNote(tab.path);
      const mem = tab.body;
      const useDisk =
        mem === undefined ||
        !tab.dirty ||
        disk.length > mem.length + 200;
      if (useDisk) {
        activateLoaded(set, get().vaultPath, tab.path, disk, tabs, false);
        void get().loadActiveNoteComments();
        return;
      }
    } catch {
      // Fall through to memory / error paths below.
    }
  }
  if (tab.body !== undefined) {
    activateLoaded(
      set,
      get().vaultPath,
      tab.path,
      tab.body,
      tabs,
      Boolean(tab.dirty),
    );
    void get().loadActiveNoteComments();
    return;
  }
  set({ loading: true, tabs, dirty: false });
  try {
    const body = await readNote(tab.path);
    activateLoaded(set, get().vaultPath, tab.path, body, tabs);
    void get().loadActiveNoteComments();
  } catch {
    set({
      loading: false,
      tabs,
      activePath: null,
      content: "",
      dirty: false,
      activeNoteComments: [],
    });
  }
}

/** Prefer the next surviving tab after `activePath`, else the previous one. */
function pickFallbackTab(
  tabs: EditorTab[],
  nextTabs: EditorTab[],
  activePath: string,
): EditorTab {
  const idx = tabs.findIndex((t) => t.path === activePath);
  if (idx >= 0) {
    for (let i = idx + 1; i < tabs.length; i++) {
      const hit = nextTabs.find((t) => t.path === tabs[i]!.path);
      if (hit) return hit;
    }
    for (let i = idx - 1; i >= 0; i--) {
      const hit = nextTabs.find((t) => t.path === tabs[i]!.path);
      if (hit) return hit;
    }
  }
  return nextTabs[0]!;
}

/**
 * Drop editor tabs whose files no longer exist in `tree` (e.g. removed by sync).
 * Virtual tabs (graph, settings) are kept. If the active note vanished, activate a neighbour.
 */
async function pruneMissingTabs(
  set: (partial: Partial<VaultStore>) => void,
  get: () => VaultStore,
  tree: TreeNode,
): Promise<void> {
  const files = new Set(collectFilePaths(tree));
  const dirs = new Set(collectDirPaths(tree));
  const { tabs, activePath } = get();
  const nextTabs = tabs.filter(
    (t) => isVirtualTab(t) || tabPathExistsInTree(t.path, files, dirs),
  );
  const activeStillOpen =
    activePath != null && nextTabs.some((t) => t.path === activePath);
  const lostActive = activePath != null && !activeStillOpen;

  if (nextTabs.length === tabs.length && !lostActive) {
    set({ tree });
    return;
  }

  if (!lostActive) {
    set({ tree, tabs: nextTabs });
    persistSession(get());
    return;
  }

  // File gone from disk — discard dirty buffer; do not try to save.
  if (!nextTabs.length) {
    set({
      tree,
      tabs: [],
      activePath: null,
      content: "",
      dirty: false,
      loading: false,
    });
    persistSession(get());
    return;
  }

  const fallback = pickFallbackTab(tabs, nextTabs, activePath!);
  set({ tree });
  await activateTab(set, get, fallback, nextTabs);
  persistSession(get());
}

/** Open or focus a singleton virtual tab (graph, settings). */
async function openSingletonTab(
  set: (partial: Partial<VaultStore>) => void,
  get: () => VaultStore,
  path: string,
  kind: TabKind,
  syncTreeSelection: boolean,
): Promise<void> {
  const stashed = stashActiveIntoTabs(
    get().tabs,
    get().activePath,
    get().content,
    get().dirty,
  );
  if (stashed !== get().tabs) {
    set({ tabs: stashed });
  }

  const active = get().tabs.find((t) => t.path === get().activePath);
  if (get().dirty && active && isFileTab(active)) {
    await get().saveActive();
  }

  const { tabs, activePath } = get();
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    if (activePath === existing.path) {
      set(
        syncTreeSelection
          ? { selectedFolderExplicit: false, treeSelectionVisible: true }
          : { treeSelectionVisible: false },
      );
      return;
    }
    activateVirtualTab(set, existing.path, tabs, syncTreeSelection);
    persistSession(get());
    return;
  }

  const nextTabs: EditorTab[] = [...tabs, { path, kind, preview: false }];
  activateVirtualTab(set, path, nextTabs, syncTreeSelection);
  persistSession(get());
}

/** Close every tab whose path is not in `keepPaths` (save dirty active if closing it). */
async function closeTabsKeeping(
  set: (partial: Partial<VaultStore>) => void,
  get: () => VaultStore,
  keepPaths: Set<string>,
): Promise<void> {
  let { tabs, activePath, dirty, content } = get();
  if (tabs.every((t) => keepPaths.has(t.path))) return;

  const closingActive =
    activePath != null && !keepPaths.has(activePath);

  if (closingActive && dirty) {
    const active = tabs.find((t) => t.path === activePath);
    if (active && isFileTab(active)) {
      await get().saveActive();
      ({ tabs, activePath, dirty, content } = get());
    }
  } else if (activePath && keepPaths.has(activePath)) {
    tabs = stashActiveIntoTabs(tabs, activePath, content, dirty);
  }

  const nextTabs = tabs.filter((t) => keepPaths.has(t.path));

  if (!closingActive) {
    set({ tabs: nextTabs });
    persistSession(get());
    return;
  }

  if (!nextTabs.length) {
    set({
      tabs: [],
      activePath: null,
      content: "",
      dirty: false,
    });
    persistSession(get());
    return;
  }

  const fallback = pickFallbackTab(tabs, nextTabs, activePath!);
  await activateTab(set, get, fallback, nextTabs);
  persistSession(get());
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  tree: null,
  tabs: [],
  activePath: null,
  selectedFolderPath: "",
  selectedFolderExplicit: false,
  treeSelectionVisible: false,
  expandedPaths: [],
  favoritePaths: [],
  projectPropertiesByPath: {},
  allComments: [],
  activeNoteComments: [],
  vaultTags: [],
  dictionaryTags: [],
  content: "",
  viewMode: "live",
  showOutline: false,
  showComments: false,
  pendingCommentFocusId: null,
  dirty: false,
  saving: false,
  loading: false,
  error: null,
  pendingPdfPage: null,
  suppressWatchUntil: 0,

  takePendingPdfPage: () => {
    const page = get().pendingPdfPage;
    if (page != null) set({ pendingPdfPage: null });
    return page;
  },

  refreshVaultTags: async () => {
    try {
      const vaultTags = await listVaultTags();
      set({ vaultTags });
    } catch {
      set({ vaultTags: [] });
    }
  },

  refreshDictionaryTags: async () => {
    try {
      const dictionaryTags = await listDictionaryTags();
      set({ dictionaryTags });
    } catch {
      set({ dictionaryTags: [] });
    }
  },

  refreshProjectProperties: async () => {
    const projectPropertiesByPath = await loadProjectPropertiesMap();
    set({ projectPropertiesByPath });
  },

  upsertProjectProperties: (props) => {
    set({
      projectPropertiesByPath: {
        ...get().projectPropertiesByPath,
        [props.path]: props,
      },
    });
  },

  /** Patch tag index for one note after an external disk change. */
  reindexVaultNoteTags: async (path) => {
    try {
      const vaultTags = await reindexNoteTagsApi(path);
      set({ vaultTags });
    } catch {
      await get().refreshVaultTags();
    }
  },

  openVaultAt: async (path) => {
    set({ loading: true, error: null });
    try {
      const tree = await openVault(path);
      const [expandedPaths, favoritePaths, projectPropertiesByPath, session] =
        await Promise.all([
          loadExpandedPaths(path),
          loadFavoritePaths(),
          loadProjectPropertiesMap(),
          loadVaultSession(path),
        ]);
      const files = new Set(collectFilePaths(tree));
      const dirs = new Set(collectDirPaths(tree));
      const restoredTabs: EditorTab[] = (session?.tabs ?? [])
        .filter(
          (t) =>
            isVirtualTab({ kind: t.kind ?? "file", path: t.path }) ||
            tabPathExistsInTree(t.path, files, dirs),
        )
        .map((t) => ({
          path: t.path,
          preview: Boolean(t.preview),
          kind: isGraphTab({ kind: t.kind ?? "file", path: t.path })
            ? "graph"
            : isSettingsTab({ kind: t.kind ?? "file", path: t.path })
              ? "settings"
              : "file",
        }));

      set({
        vaultPath: path,
        tree,
        loading: false,
        activePath: null,
        content: "",
        dirty: false,
        selectedFolderPath: "",
        selectedFolderExplicit: false,
        treeSelectionVisible: false,
        expandedPaths,
        favoritePaths,
        projectPropertiesByPath,
        vaultTags: [],
        dictionaryTags: [],
        allComments: [],
        activeNoteComments: [],
        pendingCommentFocusId: null,
        tabs: restoredTabs,
      });
      void get().refreshVaultTags();
      void get().refreshDictionaryTags();
      void get().refreshAllComments();

      if (restoredTabs.length > 0) {
        const active =
          session?.activePath &&
          restoredTabs.some((t) => t.path === session.activePath)
            ? session.activePath
            : restoredTabs[0].path;
        const activeTab = restoredTabs.find((t) => t.path === active);
        if (activeTab && isVirtualTab(activeTab)) {
          await get().openNote(activeTab.path, { syncTreeSelection: false });
          return;
        }
        const preview = activeTab?.preview ?? false;
        await get().openNote(active, { preview, syncTreeSelection: false });
        return;
      }

      // Only greet on a first visit; an empty saved session means the user
      // closed every tab and expects the vault to open blank.
      if (session) return;

      const welcome =
        tree.children?.find((c) => c.path === "Welcome.md") ??
        tree.children?.find((c) => !c.isDir && c.path.toLowerCase().endsWith(".md"));
      if (welcome) {
        await get().openNote(welcome.path, { preview: true, syncTreeSelection: false });
      }
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  refreshTree: (() => {
    let tail: Promise<void> = Promise.resolve();
    let scheduled = false;
    return () => {
      if (scheduled) return tail;
      scheduled = true;
      tail = tail.then(async () => {
        scheduled = false;
        try {
          const [tree, favoritePaths, projectPropertiesByPath] =
            await Promise.all([
              listTree(),
              loadFavoritePaths(),
              loadProjectPropertiesMap(),
            ]);
          set({ favoritePaths, projectPropertiesByPath });
          await pruneMissingTabs(set, get, tree);
          void get().refreshAllComments();
          void get().loadActiveNoteComments();
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      });
      return tail;
    };
  })(),

  openNote: async (path, options) => {
    if (path === GRAPH_TAB_PATH) {
      await get().openGraphTab({ syncTreeSelection: options?.syncTreeSelection });
      return;
    }
    if (path === SETTINGS_TAB_PATH) {
      await get().openSettingsTab({
        syncTreeSelection: options?.syncTreeSelection,
      });
      return;
    }
    const asPreview = options?.preview !== false;
    const syncTreeSelection = options?.syncTreeSelection !== false;
    const pdfPage =
      typeof options?.page === "number" && options.page >= 1
        ? Math.floor(options.page)
        : null;
    const stashed = stashActiveIntoTabs(
      get().tabs,
      get().activePath,
      get().content,
      get().dirty,
    );
    if (stashed !== get().tabs) {
      set({ tabs: stashed });
    }

    {
      const active = get().tabs.find((t) => t.path === get().activePath);
      if (get().dirty && active && isFileTab(active)) {
        // Never flush a truncated in-memory buffer over a fuller disk restore
        // (e.g. git checkout while the wiped note is still open/dirty).
        let skipSave = false;
        if (!isPdfPath(active.path)) {
          try {
            const disk = await readNote(active.path);
            const mem = get().content;
            if (disk.length > mem.length + 200) {
              skipSave = true;
              set({
                dirty: false,
                content: disk,
                tabs: withTabBody(get().tabs, active.path, disk, false),
              });
            }
          } catch {
            // Fall through to normal save.
          }
        }
        if (!skipSave) await get().saveActive();
      }
    }

    const loadContent = async (): Promise<string> => {
      if (isPdfPath(path)) return "";
      return readNote(path);
    };

    /**
     * Prefer on-disk content when the tab is clean, or when disk is clearly a
     * fuller restore over a truncated in-memory buffer (git checkout / sync).
     */
    const resolveOpenContent = async (
      tab: EditorTab,
    ): Promise<{ content: string; dirty: boolean }> => {
      if (isPdfPath(path)) return { content: "", dirty: false };
      const disk = await loadContent();
      const mem = tab.body;
      if (mem === undefined) return { content: disk, dirty: false };
      if (!tab.dirty) return { content: disk, dirty: false };
      if (disk.length > mem.length + 200) {
        return { content: disk, dirty: false };
      }
      return { content: mem, dirty: true };
    };

    const { tabs } = get();
    const existing = tabs.find((t) => t.path === path && isFileTab(t));
    if (existing) {
      // Already open: activate; if requesting permanent, pin it
      const nextTabs =
        !asPreview && existing.preview
          ? tabs.map((t) => (t.path === path ? { ...t, preview: false } : t))
          : tabs;

      set({ loading: true, error: null });
      try {
        const { content, dirty } = await resolveOpenContent(existing);
        activateLoaded(
          set,
          get().vaultPath,
          path,
          content,
          nextTabs,
          dirty,
          syncTreeSelection,
        );
        if (pdfPage != null) set({ pendingPdfPage: pdfPage });
        persistSession(get());
        void get().loadActiveNoteComments();
      } catch (e) {
        set({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    set({ loading: true, error: null });
    try {
      const content = await loadContent();
      let nextTabs = [...get().tabs];

      if (asPreview) {
        const previewIdx = nextTabs.findIndex((t) => t.preview && isFileTab(t));
        const tab: EditorTab = {
          path,
          kind: "file",
          preview: true,
          body: content,
          dirty: false,
        };
        if (previewIdx >= 0) {
          nextTabs[previewIdx] = tab;
        } else {
          nextTabs.push(tab);
        }
      } else {
        nextTabs.push({
          path,
          kind: "file",
          preview: false,
          body: content,
          dirty: false,
        });
      }

      activateLoaded(
        set,
        get().vaultPath,
        path,
        content,
        nextTabs,
        false,
        syncTreeSelection,
      );
      if (pdfPage != null) set({ pendingPdfPage: pdfPage });
      persistSession(get());
      void get().loadActiveNoteComments();
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  openGraphTab: async (options) => {
    await openSingletonTab(
      set,
      get,
      GRAPH_TAB_PATH,
      "graph",
      options?.syncTreeSelection !== false,
    );
  },

  openSettingsTab: async (options) => {
    await openSingletonTab(
      set,
      get,
      SETTINGS_TAB_PATH,
      "settings",
      options?.syncTreeSelection !== false,
    );
  },

  pinTab: (path) => {
    const { tabs } = get();
    if (!tabs.some((t) => t.path === path && t.preview)) return;
    set({
      tabs: tabs.map((t) => (t.path === path ? { ...t, preview: false } : t)),
    });
    persistSession(get());
  },

  reorderTabs: (fromIndex, toIndex) => {
    const { tabs } = get();
    const nextTabs = arrayMove(tabs, fromIndex, toIndex);
    if (nextTabs === tabs) return;
    set({ tabs: nextTabs });
    persistSession(get());
  },

  closeTab: async (path) => {
    const { tabs, activePath, dirty, saveActive, content } = get();
    const closing = tabs.find((t) => t.path === path);
    if (dirty && activePath === path && closing && isFileTab(closing)) {
      await saveActive();
    }

    const index = tabs.findIndex((t) => t.path === path);
    if (index < 0) return;
    // Drop closed tab; stash active buffer if we're keeping it open.
    let nextTabs = tabs.filter((t) => t.path !== path);
    if (activePath && activePath !== path) {
      nextTabs = stashActiveIntoTabs(nextTabs, activePath, content, dirty);
    }

    if (activePath !== path) {
      set({ tabs: nextTabs });
      persistSession(get());
      return;
    }

    const fallback = nextTabs[index] ?? nextTabs[index - 1] ?? null;
    if (!fallback) {
      set({
        tabs: [],
        activePath: null,
        content: "",
        dirty: false,
      });
      persistSession(get());
      return;
    }

    await activateTab(set, get, fallback, nextTabs);
    persistSession(get());
  },

  closeOtherTabs: async (path) => {
    await closeTabsKeeping(set, get, new Set([path]));
  },

  closeTabsToTheRight: async (path) => {
    const { tabs } = get();
    const index = tabs.findIndex((t) => t.path === path);
    if (index < 0) return;
    await closeTabsKeeping(
      set,
      get,
      new Set(tabs.slice(0, index + 1).map((t) => t.path)),
    );
  },

  setContent: (content) => {
    const { activePath, tabs, content: prev } = get();
    if (content === prev) return;
    const patch: Partial<VaultStore> = { content, dirty: true };
    if (activePath) {
      patch.tabs = tabs.map((t) => {
        if (t.path !== activePath) return t;
        if (t.body === content) return t;
        return {
          ...t,
          body: content,
          dirty: true,
          preview: false,
        };
      });
    }
    set(patch);
    if (patch.tabs) persistSession(get());
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => {
    const { viewMode } = get();
    set({ viewMode: viewMode === "live" ? "source" : "live" });
  },

  toggleOutline: () => {
    const { showOutline, activePath, vaultPath } = get();
    const next = !showOutline;
    set({ showOutline: next });
    if (activePath) saveDocOutlineOpen(vaultPath, activePath, next);
  },

  toggleComments: () => {
    const { showComments, activePath, vaultPath } = get();
    const next = !showComments;
    set({ showComments: next });
    if (activePath) saveDocCommentsOpen(vaultPath, activePath, next);
  },

  refreshAllComments: async () => {
    try {
      const allComments = await listAllComments();
      set({ allComments });
    } catch {
      set({ allComments: [] });
    }
  },

  loadActiveNoteComments: async () => {
    const { activePath } = get();
    if (!activePath || !activePath.toLowerCase().endsWith(".md")) {
      set({ activeNoteComments: [] });
      return;
    }
    try {
      const activeNoteComments = await listNoteComments(activePath);
      if (get().activePath !== activePath) return;
      set({ activeNoteComments });
    } catch {
      if (get().activePath === activePath) set({ activeNoteComments: [] });
    }
  },

  upsertActiveComment: async (input) => {
    const { activePath, activeNoteComments: prev } = get();
    if (!activePath || !activePath.toLowerCase().endsWith(".md")) return null;
    try {
      set({ suppressWatchUntil: Date.now() + 800 });
      const wasCreate =
        !input.id || !prev.some((c) => c.id === input.id);
      const created = await upsertNoteComment(activePath, input);
      const activeNoteComments = await listNoteComments(activePath);
      if (wasCreate) {
        set({ activeNoteComments, showComments: true });
        saveDocCommentsOpen(get().vaultPath, activePath, true);
      } else {
        set({ activeNoteComments });
      }
      void get().refreshAllComments();
      return created;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  deleteActiveComment: async (id) => {
    const { activePath } = get();
    if (!activePath || !id) return;
    try {
      set({ suppressWatchUntil: Date.now() + 800 });
      await deleteNoteComment(activePath, id);
      const activeNoteComments = await listNoteComments(activePath);
      set({ activeNoteComments });
      void get().refreshAllComments();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setActiveCommentResolved: async (id, resolved) => {
    const { activePath } = get();
    if (!activePath || !id) return;
    try {
      set({ suppressWatchUntil: Date.now() + 800 });
      await setCommentResolved(activePath, id, resolved);
      const activeNoteComments = await listNoteComments(activePath);
      set({ activeNoteComments });
      void get().refreshAllComments();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  openComment: async (notePath, commentId) => {
    if (!notePath || !commentId) return;
    set({ pendingCommentFocusId: commentId, showComments: true });
    saveDocCommentsOpen(get().vaultPath, notePath, true);
    await get().openNote(notePath, { preview: false });
    void get().loadActiveNoteComments();
  },

  takePendingCommentFocus: () => {
    const id = get().pendingCommentFocusId;
    if (id != null) set({ pendingCommentFocusId: null });
    return id;
  },

  saveActive: async () => {
    const { activePath, content, dirty, tabs } = get();
    if (!activePath || !dirty) return;
    if (isPdfPath(activePath)) return;
    const active = tabs.find((t) => t.path === activePath);
    if (active && isVirtualTab(active)) return;
    // Cover watcher poll + embeddings debounce so our own write does not
    // thrash tree refresh / tag reindex while the user is still editing.
    set({ saving: true, suppressWatchUntil: Date.now() + 6_000 });
    try {
      const savedContent = await writeNote(activePath, content);
      const current = get();
      if (
        current.activePath !== activePath ||
        current.content !== content
      ) {
        set({ saving: false });
        return;
      }
      set({
        content: savedContent,
        dirty: false,
        saving: false,
        tabs: withTabBody(current.tabs, activePath, savedContent, false),
      });
      // Tag index was already patched in write_note; refresh UI catalogs after
      // a short settle so rapid saves do not spam listVaultTags IPC.
      scheduleTagCatalogRefresh(() => get().refreshVaultTags());
      if (activePath.toLowerCase().endsWith(".mddict")) {
        void get().refreshDictionaryTags();
      }
    } catch (e) {
      set({
        saving: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  selectFolder: (path) =>
    set({
      selectedFolderPath: path,
      selectedFolderExplicit: true,
      treeSelectionVisible: true,
    }),

  openOrCreateFolderNote: async (folder) => {
    const cleaned = folder.replace(/^\/+|\/+$/g, "");
    if (!cleaned) {
      get().selectFolder("");
      return;
    }
    get().selectFolder(cleaned);
    try {
      const notePath = await ensureFolderNote(cleaned);
      await get().openNote(notePath, { preview: true });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  isExpanded: (path) => {
    if (path === "") return true;
    return get().expandedPaths.includes(path);
  },

  toggleExpanded: (path) => {
    if (path === "") return;
    const { vaultPath, expandedPaths } = get();
    const next = expandedPaths.includes(path)
      ? expandedPaths.filter((p) => p !== path)
      : [...expandedPaths, path];
    set({ expandedPaths: next });
    if (vaultPath) void saveExpandedPaths(vaultPath, next);
  },

  collapseAllFolders: () => {
    const { vaultPath, expandedPaths } = get();
    if (expandedPaths.length === 0) return;
    set({ expandedPaths: [] });
    if (vaultPath) void saveExpandedPaths(vaultPath, []);
  },

  isFavorite: (path) => {
    if (!path) return false;
    return get().favoritePaths.includes(path);
  },

  addToFavorites: async (path) => {
    if (!path) return;
    try {
      set({ suppressWatchUntil: Date.now() + 800 });
      const favoritePaths = await addFavorite(path);
      set({ favoritePaths });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  removeFromFavorites: async (path) => {
    if (!path) return;
    try {
      set({ suppressWatchUntil: Date.now() + 800 });
      const favoritePaths = await removeFavorite(path);
      set({ favoritePaths });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createNoteInSelection: async (name) => {
    const { selectedFolderPath } = get();
    const trimmed = name.trim().replace(/\.md$/i, "");
    if (!trimmed) return;
    try {
      const rel = joinPath(selectedFolderPath, trimmed);
      const created = await createNote(rel);
      await get().refreshTree();
      await get().openNote(created, { preview: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  openOrCreateDailyNote: async (fromPath, date, options) => {
    const { projectPropertiesByPath } = get();
    const projectRoot = diaryProjectRootForPath(
      fromPath,
      projectPropertiesByPath,
    );
    if (!projectRoot) {
      set({ error: "Daily notes are only available in diary projects." });
      return null;
    }
    const day = date ?? new Date();
    const rel = dailyNotePath(projectRoot, day);
    const asPreview = options?.preview === true;
    try {
      try {
        await readNote(rel);
        await get().openNote(rel, {
          preview: asPreview,
          syncTreeSelection: false,
        });
        return { path: rel, created: false };
      } catch {
        // Note missing — create below.
      }

      const createdPath = await createNote(rel);
      const initial = await readNote(createdPath);
      const tagged = setNoteTags(initial, [
        "diary",
        ...getNoteTags(initial).filter(
          (t) => t.toLowerCase() !== "diary",
        ),
      ]);
      await writeNote(createdPath, tagged);
      await get().refreshTree();
      void get().refreshVaultTags();
      await get().openNote(createdPath, {
        preview: asPreview,
        syncTreeSelection: false,
      });
      return { path: createdPath, created: true };
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  createDrawioInSelection: async (name) => {
    const { selectedFolderPath } = get();
    const trimmed = name.trim().replace(/\.drawio$/i, "").replace(/\.md$/i, "");
    if (!trimmed) return;
    try {
      const rel = joinPath(selectedFolderPath, trimmed);
      const created = await createDrawio(rel);
      await get().refreshTree();
      await get().openNote(created, { preview: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createMdlnksInSelection: async (name) => {
    const { selectedFolderPath } = get();
    const trimmed = name
      .trim()
      .replace(/\.mdlnks$/i, "")
      .replace(/\.mddict$/i, "")
      .replace(/\.drawio$/i, "")
      .replace(/\.md$/i, "");
    if (!trimmed) return;
    try {
      const rel = joinPath(selectedFolderPath, trimmed);
      const created = await createMdlnks(rel);
      await get().refreshTree();
      await get().openNote(created, { preview: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createMddictInSelection: async (name) => {
    const { selectedFolderPath } = get();
    const trimmed = name
      .trim()
      .replace(/\.mddict$/i, "")
      .replace(/\.mdlnks$/i, "")
      .replace(/\.drawio$/i, "")
      .replace(/\.md$/i, "");
    if (!trimmed) return;
    try {
      const rel = joinPath(selectedFolderPath, trimmed);
      const created = await createMddict(rel);
      await get().refreshTree();
      void get().refreshDictionaryTags();
      await get().openNote(created, { preview: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createFolderInSelection: async (name) => {
    const { selectedFolderPath, vaultPath, expandedPaths } = get();
    const trimmed = name.trim().replace(/\/+$/g, "");
    if (!trimmed) return;
    try {
      const rel = joinPath(selectedFolderPath, trimmed);
      const created = await createFolder(rel);
      let nextExpanded = expandedPaths;
      if (selectedFolderPath && !expandedPaths.includes(selectedFolderPath)) {
        nextExpanded = [...expandedPaths, selectedFolderPath];
        set({ expandedPaths: nextExpanded });
        if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);
      }
      set({ selectedFolderPath: created, selectedFolderExplicit: true, treeSelectionVisible: true });
      await get().refreshTree();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createSkill: async (id) => {
    const trimmed = id.trim().toLowerCase().replace(/\.md$/i, "");
    if (!isValidSkillId(trimmed)) {
      set({
        error:
          "Skill id must be lowercase letters, digits, and hyphens (e.g. meeting-notes)",
      });
      return;
    }
    try {
      const rel = skillPathForId(trimmed);
      const created = await createNote(rel);
      await writeNote(created, skillTemplate(trimmed));
      const { vaultPath, expandedPaths } = get();
      let nextExpanded = expandedPaths;
      if (!expandedPaths.includes("Skills")) {
        nextExpanded = [...expandedPaths, "Skills"];
        set({ expandedPaths: nextExpanded });
        if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);
      }
      set({ selectedFolderPath: "Skills", selectedFolderExplicit: true, treeSelectionVisible: true });
      await get().refreshTree();
      await get().openNote(created, { preview: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  moveTreeEntry: async (from, toParent, toIndex) => {
    if (isSkillsFolder(from) && toParent !== "") {
      set({ error: "Cannot move the Skills folder into another folder" });
      return null;
    }
    const { activePath, dirty, saveActive, vaultPath, expandedPaths, selectedFolderPath, tabs } =
      get();
    try {
      if (dirty && activePath) {
        await saveActive();
      }
      set({ suppressWatchUntil: Date.now() + 1200 });
      const nextPath = await moveEntry(from, toParent, toIndex);

      let nextExpanded = expandedPaths;
      if (from !== nextPath) {
        nextExpanded = remapExpanded(expandedPaths, from, nextPath);
        set({ expandedPaths: nextExpanded });
        if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);
      }

      const patch: Partial<VaultStore> = {
        tabs: remapTabs(tabs, from, nextPath),
      };
      if (activePath === from || activePath?.startsWith(`${from}/`)) {
        if (activePath === from) {
          patch.activePath = nextPath;
        } else if (activePath) {
          patch.activePath = `${nextPath}${activePath.slice(from.length)}`;
        }
      }
      if (selectedFolderPath === from || selectedFolderPath.startsWith(`${from}/`)) {
        if (selectedFolderPath === from) {
          patch.selectedFolderPath = nextPath;
        } else {
          patch.selectedFolderPath = `${nextPath}${selectedFolderPath.slice(from.length)}`;
        }
      }
      set(patch);

      // Reload content if the open note moved (asset refs may have been rewritten).
      const openAfter = get().activePath;
      if (openAfter && (activePath === from || (activePath && openAfter !== activePath))) {
        try {
          const content = await readNote(openAfter);
          set({
            content,
            dirty: false,
            tabs: withTabBody(get().tabs, openAfter, content, false),
          });
        } catch {
          /* keep previous content */
        }
      }

      persistSession(get());
      await get().refreshTree();
      void get().refreshVaultTags();
      void get().refreshDictionaryTags();
      return nextPath;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  nestTreeEntryUnderNote: async (from, notePath, toIndex = 0) => {
    if (isSkillsFolder(from)) {
      set({ error: "Cannot move the Skills folder" });
      return null;
    }
    const { activePath, dirty, saveActive, vaultPath, expandedPaths, selectedFolderPath, tabs } =
      get();
    try {
      if (dirty && activePath) {
        await saveActive();
      }
      set({ suppressWatchUntil: Date.now() + 1500 });
      const result = await nestUnderNote(from, notePath, toIndex);

      let nextTabs = remapTabs(tabs, notePath, result.folderNote);
      nextTabs = remapTabs(nextTabs, from, result.moved);

      let nextExpanded = remapExpanded(expandedPaths, from, result.moved);
      if (!nextExpanded.includes(result.folder)) {
        nextExpanded = [...nextExpanded, result.folder];
      }
      set({ expandedPaths: nextExpanded });
      if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);

      const patch: Partial<VaultStore> = { tabs: nextTabs };

      const remapActive = (path: string | null): string | null => {
        if (!path) return null;
        if (path === notePath) return result.folderNote;
        if (path === from) return result.moved;
        if (path.startsWith(`${from}/`)) {
          return `${result.moved}${path.slice(from.length)}`;
        }
        return path;
      };
      const nextActive = remapActive(activePath);
      if (nextActive !== activePath) {
        patch.activePath = nextActive;
      }

      if (selectedFolderPath === from || selectedFolderPath.startsWith(`${from}/`)) {
        if (selectedFolderPath === from) {
          patch.selectedFolderPath = result.moved;
        } else {
          patch.selectedFolderPath = `${result.moved}${selectedFolderPath.slice(from.length)}`;
        }
      } else if (selectedFolderPath === notePath) {
        patch.selectedFolderPath = result.folder;
        patch.selectedFolderExplicit = true;
      }

      set(patch);

      const openAfter = get().activePath;
      if (
        openAfter &&
        (activePath === from ||
          activePath === notePath ||
          (activePath && openAfter !== activePath))
      ) {
        try {
          const content = await readNote(openAfter);
          set({
            content,
            dirty: false,
            tabs: withTabBody(get().tabs, openAfter, content, false),
          });
        } catch {
          /* keep previous content */
        }
      }

      persistSession(get());
      await get().refreshTree();
      void get().refreshVaultTags();
      void get().refreshDictionaryTags();
      return result.moved;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  renameTreeEntry: async (from, nextName) => {
    if (isSkillsFolder(from)) {
      set({ error: "Cannot rename the Skills folder" });
      return;
    }
    const trimmed = nextName.trim().replace(/[\\/]/g, "");
    if (!trimmed || !from) return;

    const to = joinPath(parentPath(from), trimmed);
    if (isSkillsFolder(to)) {
      set({ error: "Cannot rename to the reserved Skills folder" });
      return;
    }
    const fromKind = documentKind(from);
    if (fromKind === "drawio") {
      if (to === from || to === from.replace(/\.drawio$/i, "")) return;
    } else if (fromKind === "mdlnks") {
      if (to === from || to === from.replace(/\.mdlnks$/i, "")) return;
    } else if (fromKind === "mddict") {
      if (to === from || to === from.replace(/\.mddict$/i, "")) return;
    } else if (to === from || to === from.replace(/\.md$/i, "")) {
      return;
    }

    const { activePath, dirty, saveActive, vaultPath, expandedPaths, selectedFolderPath, tabs } =
      get();
    try {
      if (dirty && activePath) {
        await saveActive();
      }
      set({ suppressWatchUntil: Date.now() + 1200 });
      const nextPath = await renamePath(from, to);

      let nextExpanded = expandedPaths;
      if (from !== nextPath) {
        nextExpanded = remapExpanded(expandedPaths, from, nextPath);
        set({ expandedPaths: nextExpanded });
        if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);
      }

      const patch: Partial<VaultStore> = {
        tabs: remapTabs(tabs, from, nextPath),
      };
      if (activePath === from || activePath?.startsWith(`${from}/`)) {
        if (activePath === from) {
          patch.activePath = nextPath;
        } else if (activePath) {
          patch.activePath = `${nextPath}${activePath.slice(from.length)}`;
        }
      }
      if (selectedFolderPath === from || selectedFolderPath.startsWith(`${from}/`)) {
        if (selectedFolderPath === from) {
          patch.selectedFolderPath = nextPath;
        } else {
          patch.selectedFolderPath = `${nextPath}${selectedFolderPath.slice(from.length)}`;
        }
      }
      set(patch);

      const openAfter = get().activePath;
      if (openAfter && (activePath === from || (activePath && openAfter !== activePath))) {
        try {
          const content = await readNote(openAfter);
          set({
            content,
            dirty: false,
            tabs: withTabBody(get().tabs, openAfter, content, false),
          });
        } catch {
          /* keep previous content */
        }
      }

      persistSession(get());
      await get().refreshTree();
      void get().refreshVaultTags();
      void get().refreshDictionaryTags();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  removePath: async (path) => {
    if (isSkillsFolder(path)) {
      set({ error: "Cannot delete the Skills folder" });
      return false;
    }
    const { vaultPath, expandedPaths, selectedFolderPath, tabs, activePath, dirty, saveActive } =
      get();
    try {
      if (dirty && activePath && (activePath === path || activePath.startsWith(`${path}/`))) {
        await saveActive();
      }
      await deletePath(path);

      const nextTabs = tabs.filter(
        (t) =>
          isVirtualTab(t) ||
          (t.path !== path && !t.path.startsWith(`${path}/`)),
      );
      const lostActive =
        activePath != null && !nextTabs.some((t) => t.path === activePath);

      if (!lostActive) {
        set({ tabs: nextTabs });
      } else if (!nextTabs.length) {
        set({
          tabs: [],
          activePath: null,
          content: "",
          dirty: false,
        });
      } else {
        const fallback = nextTabs[nextTabs.length - 1]!;
        await activateTab(set, get, fallback, nextTabs);
      }

      if (selectedFolderPath === path || selectedFolderPath.startsWith(`${path}/`)) {
        set({ selectedFolderPath: parentPath(path) });
      }
      const nextExpanded = expandedPaths.filter(
        (p) => p !== path && !p.startsWith(`${path}/`),
      );
      set({ expandedPaths: nextExpanded });
      if (vaultPath) void saveExpandedPaths(vaultPath, nextExpanded);
      persistSession(get());
      await get().refreshTree();
      void get().refreshVaultTags();
      void get().refreshDictionaryTags();
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  importIntoSelection: async (sources, files = []) => {
    const parent = get().selectedFolderPath;
    const created: string[] = [];
    try {
      set({ suppressWatchUntil: Date.now() + 2000 });
      if (sources.length) {
        const paths = await importPaths(parent, sources);
        created.push(...paths);
      } else if (files.length) {
        for (const file of files) {
          const buf = new Uint8Array(await file.arrayBuffer());
          const path = await importDocumentBytes(parent, file.name, buf);
          created.push(path);
        }
      }
      if (created.length) {
        await get().refreshTree();
        void get().refreshVaultTags();
        void get().refreshDictionaryTags();
      }
      return created;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return created;
    }
  },

  markExternalWrite: (ms = 1200) =>
    set((s) => ({
      suppressWatchUntil: Math.max(s.suppressWatchUntil, Date.now() + ms),
    })),

  settleExternalWrite: (ms = 1200) =>
    set({ suppressWatchUntil: Date.now() + ms }),

  applyExternalContent: (path, content) => {
    const state = get();
    const { activePath, tabs } = state;
    const tab = tabs.find((t) => t.path === path);
    const hasTab = Boolean(tab);
    if (!hasTab && activePath !== path) return;

    const tabUnchanged = !hasTab || (tab!.body === content && !tab!.dirty);
    const activeUnchanged =
      activePath !== path || (state.content === content && !state.dirty);
    if (tabUnchanged && activeUnchanged) return;

    const patch: Partial<VaultStore> = {};
    if (hasTab) {
      patch.tabs = withTabBody(tabs, path, content, false);
    }
    if (activePath === path) {
      patch.content = content;
      patch.dirty = false;
    }
    set(patch);
  },

  reloadOpenTabsFromDisk: async () => {
    const { tabs, activePath, dirty } = get();
    const targets = tabs.filter(
      (t) => isFileTab(t) && !isPdfPath(t.path) && !t.dirty,
    );
    for (const tab of targets) {
      if (tab.path === activePath && dirty) continue;
      try {
        const next = await readNote(tab.path);
        get().applyExternalContent(tab.path, next);
      } catch {
        // Missing files are closed by pruneMissingTabs via refreshTree.
      }
    }
  },
}));

export { tabLabel };

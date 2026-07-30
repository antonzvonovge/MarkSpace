import { create } from "zustand";
import type { TreeNode } from "../lib/vaultApi";
import {
  addFavorite,
  createDrawio,
  createFolder,
  createNote,
  deletePath,
  documentKind,
  importDocumentBytes,
  importPaths,
  joinPath,
  listFavorites,
  listTree,
  moveEntry,
  openVault,
  parentPath,
  readNote,
  removeFavorite,
  renamePath,
  writeNote,
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

export type EditorTab = {
  path: string;
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
};

type VaultStore = {
  vaultPath: string | null;
  tree: TreeNode | null;
  tabs: EditorTab[];
  activePath: string | null;
  selectedFolderPath: string;
  /** True only after the user clicks a folder in the tree (not when opening a note). */
  selectedFolderExplicit: boolean;
  expandedPaths: string[];
  /** Vault-relative favorite paths (pages and folders), sorted. */
  favoritePaths: string[];
  content: string;
  viewMode: ViewMode;
  /** Live-mode document outline (TOC) pane. */
  showOutline: boolean;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string | null;
  suppressWatchUntil: number;
  openVaultAt: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openNote: (path: string, options?: OpenNoteOptions) => Promise<void>;
  pinTab: (path: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  closeTab: (path: string) => Promise<void>;
  setContent: (content: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  toggleOutline: () => void;
  saveActive: () => Promise<void>;
  selectFolder: (path: string) => void;
  toggleExpanded: (path: string) => void;
  isExpanded: (path: string) => boolean;
  isFavorite: (path: string) => boolean;
  addToFavorites: (path: string) => Promise<void>;
  removeFromFavorites: (path: string) => Promise<void>;
  createNoteInSelection: (name: string) => Promise<void>;
  createDrawioInSelection: (name: string) => Promise<void>;
  createFolderInSelection: (name: string) => Promise<void>;
  moveTreeEntry: (from: string, toParent: string, toIndex: number) => Promise<void>;
  renameTreeEntry: (from: string, nextName: string) => Promise<void>;
  removePath: (path: string) => Promise<void>;
  /** Import OS paths / file blobs into the selected folder. */
  importIntoSelection: (
    sources: string[],
    files?: File[],
  ) => Promise<string[]>;
  /** Suppress vault-change handling for `ms` (default 1200). */
  markExternalWrite: (ms?: number) => void;
  /** Apply disk/tool content to an open tab (and the editor if active). */
  applyExternalContent: (path: string, content: string) => void;
};

async function loadFavoritePaths(): Promise<string[]> {
  try {
    return await listFavorites();
  } catch {
    return [];
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
  if (!tabs.some((t) => t.path === activePath)) return tabs;
  return withTabBody(tabs, activePath, content, dirty);
}

function tabLabel(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "").replace(/\.drawio$/i, "");
}

function collectFilePaths(node: TreeNode, out: string[] = []): string[] {
  if (!node.isDir && node.path) out.push(node.path);
  for (const child of node.children ?? []) collectFilePaths(child, out);
  return out;
}

function persistSession(state: {
  vaultPath: string | null;
  tabs: EditorTab[];
  activePath: string | null;
}) {
  if (!state.vaultPath) return;
  void saveVaultSession(state.vaultPath, {
    tabs: state.tabs.map((t) => ({ path: t.path, preview: t.preview })),
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
) {
  const outline = loadDocOutlineUi(vaultPath, path);
  set({
    tabs: withTabBody(tabs, path, content, dirty),
    activePath: path,
    content,
    dirty,
    loading: false,
    selectedFolderPath: parentPath(path),
    selectedFolderExplicit: false,
    showOutline: outline.open,
  });
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
 * If the active note vanished, activate a neighbour or clear the editor.
 */
async function pruneMissingTabs(
  set: (partial: Partial<VaultStore>) => void,
  get: () => VaultStore,
  tree: TreeNode,
): Promise<void> {
  const existing = new Set(collectFilePaths(tree));
  const { tabs, activePath } = get();
  const nextTabs = tabs.filter((t) => existing.has(t.path));
  const lostActive = activePath != null && !existing.has(activePath);

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
  set({ tree, loading: true, tabs: nextTabs, dirty: false });
  try {
    const body =
      fallback.body !== undefined ? fallback.body : await readNote(fallback.path);
    activateLoaded(
      set,
      get().vaultPath,
      fallback.path,
      body,
      nextTabs,
      Boolean(fallback.dirty && fallback.body !== undefined),
    );
  } catch {
    set({
      loading: false,
      tabs: nextTabs,
      activePath: null,
      content: "",
      dirty: false,
    });
  }
  persistSession(get());
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  tree: null,
  tabs: [],
  activePath: null,
  selectedFolderPath: "",
  selectedFolderExplicit: false,
  expandedPaths: [],
  favoritePaths: [],
  content: "",
  viewMode: "live",
  showOutline: false,
  dirty: false,
  saving: false,
  loading: false,
  error: null,
  suppressWatchUntil: 0,

  openVaultAt: async (path) => {
    set({ loading: true, error: null });
    try {
      const tree = await openVault(path);
      const [expandedPaths, favoritePaths, session] = await Promise.all([
        loadExpandedPaths(path),
        loadFavoritePaths(),
        loadVaultSession(path),
      ]);
      const existing = new Set(collectFilePaths(tree));
      const restoredTabs = (session?.tabs ?? []).filter((t) =>
        existing.has(t.path),
      );

      set({
        vaultPath: path,
        tree,
        loading: false,
        activePath: null,
        content: "",
        dirty: false,
        selectedFolderPath: "",
        selectedFolderExplicit: false,
        expandedPaths,
        favoritePaths,
        tabs: restoredTabs,
      });

      if (restoredTabs.length > 0) {
        const active =
          session?.activePath &&
          restoredTabs.some((t) => t.path === session.activePath)
            ? session.activePath
            : restoredTabs[0].path;
        const preview =
          restoredTabs.find((t) => t.path === active)?.preview ?? false;
        await get().openNote(active, { preview });
        return;
      }

      const welcome =
        tree.children?.find((c) => c.path === "Welcome.md") ??
        tree.children?.find((c) => !c.isDir && c.path.toLowerCase().endsWith(".md"));
      if (welcome) {
        await get().openNote(welcome.path, { preview: true });
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
          const [tree, favoritePaths] = await Promise.all([
            listTree(),
            loadFavoritePaths(),
          ]);
          set({ favoritePaths });
          await pruneMissingTabs(set, get, tree);
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      });
      return tail;
    };
  })(),

  openNote: async (path, options) => {
    const asPreview = options?.preview !== false;
    const stashed = stashActiveIntoTabs(
      get().tabs,
      get().activePath,
      get().content,
      get().dirty,
    );
    if (stashed !== get().tabs) {
      set({ tabs: stashed });
    }

    if (get().dirty && get().activePath) {
      await get().saveActive();
    }

    const { tabs, activePath } = get();
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      // Already open: activate; if requesting permanent, pin it
      const nextTabs =
        !asPreview && existing.preview
          ? tabs.map((t) => (t.path === path ? { ...t, preview: false } : t))
          : tabs;
      if (activePath === path) {
        if (nextTabs !== tabs) {
          set({ tabs: nextTabs, selectedFolderExplicit: false });
          persistSession(get());
        } else {
          set({ selectedFolderExplicit: false });
        }
        return;
      }

      if (existing.body !== undefined) {
        activateLoaded(
          set,
          get().vaultPath,
          path,
          existing.body,
          nextTabs,
          Boolean(existing.dirty),
        );
        persistSession(get());
        return;
      }

      set({ loading: true, error: null });
      try {
        const content = await readNote(path);
        activateLoaded(set, get().vaultPath, path, content, nextTabs);
        persistSession(get());
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
      const content = await readNote(path);
      let nextTabs = [...get().tabs];

      if (asPreview) {
        const previewIdx = nextTabs.findIndex((t) => t.preview);
        const tab: EditorTab = { path, preview: true, body: content, dirty: false };
        if (previewIdx >= 0) {
          nextTabs[previewIdx] = tab;
        } else {
          nextTabs.push(tab);
        }
      } else {
        nextTabs.push({ path, preview: false, body: content, dirty: false });
      }

      activateLoaded(set, get().vaultPath, path, content, nextTabs);
      persistSession(get());
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
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
    if (dirty && activePath === path) {
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

    if (fallback.body !== undefined) {
      activateLoaded(
        set,
        get().vaultPath,
        fallback.path,
        fallback.body,
        nextTabs,
        Boolean(fallback.dirty),
      );
      persistSession(get());
      return;
    }

    set({ loading: true, tabs: nextTabs });
    try {
      const body = await readNote(fallback.path);
      activateLoaded(set, get().vaultPath, fallback.path, body, nextTabs);
      persistSession(get());
    } catch (e) {
      set({
        loading: false,
        activePath: null,
        content: "",
        dirty: false,
        error: e instanceof Error ? e.message : String(e),
      });
      persistSession(get());
    }
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

  saveActive: async () => {
    const { activePath, content, dirty, tabs } = get();
    if (!activePath || !dirty) return;
    set({ saving: true, suppressWatchUntil: Date.now() + 1200 });
    try {
      await writeNote(activePath, content);
      set({
        dirty: false,
        saving: false,
        tabs: withTabBody(tabs, activePath, content, false),
      });
    } catch (e) {
      set({
        saving: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  selectFolder: (path) =>
    set({ selectedFolderPath: path, selectedFolderExplicit: true }),

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
      set({ selectedFolderPath: created, selectedFolderExplicit: true });
      await get().refreshTree();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  moveTreeEntry: async (from, toParent, toIndex) => {
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
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  renameTreeEntry: async (from, nextName) => {
    const trimmed = nextName.trim().replace(/[\\/]/g, "");
    if (!trimmed || !from) return;

    const to = joinPath(parentPath(from), trimmed);
    const fromKind = documentKind(from);
    if (fromKind === "drawio") {
      if (to === from || to === from.replace(/\.drawio$/i, "")) return;
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
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  removePath: async (path) => {
    const { vaultPath, expandedPaths, selectedFolderPath, tabs, activePath, dirty, saveActive } =
      get();
    try {
      if (dirty && activePath && (activePath === path || activePath.startsWith(`${path}/`))) {
        await saveActive();
      }
      await deletePath(path);

      const nextTabs = tabs.filter(
        (t) => t.path !== path && !t.path.startsWith(`${path}/`),
      );
      const lostActive =
        activePath === path || Boolean(activePath?.startsWith(`${path}/`));

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
        const fallback = nextTabs[nextTabs.length - 1];
        if (fallback.body !== undefined) {
          activateLoaded(
            set,
            get().vaultPath,
            fallback.path,
            fallback.body,
            nextTabs,
            Boolean(fallback.dirty),
          );
        } else {
          set({ loading: true, tabs: nextTabs });
          try {
            const content = await readNote(fallback.path);
            activateLoaded(set, get().vaultPath, fallback.path, content, nextTabs);
          } catch {
            set({
              loading: false,
              tabs: nextTabs,
              activePath: null,
              content: "",
              dirty: false,
            });
          }
        }
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
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
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

  applyExternalContent: (path, content) => {
    const { activePath, tabs } = get();
    const hasTab = tabs.some((t) => t.path === path);
    if (!hasTab && activePath !== path) return;
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
}));

export { tabLabel };

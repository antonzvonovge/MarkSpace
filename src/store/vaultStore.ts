import { create } from "zustand";
import type { TreeNode } from "../lib/vaultApi";
import {
  createDrawio,
  createFolder,
  createNote,
  deletePath,
  documentKind,
  joinPath,
  listTree,
  moveEntry,
  openVault,
  parentPath,
  readNote,
  renamePath,
  writeNote,
} from "../lib/vaultApi";
import {
  loadExpandedPaths,
  saveExpandedPaths,
  loadVaultSession,
  saveVaultSession,
} from "../lib/settingsStore";

export type EditorTab = {
  path: string;
  preview: boolean;
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
  content: string;
  viewMode: ViewMode;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string | null;
  suppressWatchUntil: number;
  openVaultAt: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openNote: (path: string, options?: OpenNoteOptions) => Promise<void>;
  pinTab: (path: string) => void;
  closeTab: (path: string) => Promise<void>;
  setContent: (content: string) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  saveActive: () => Promise<void>;
  selectFolder: (path: string) => void;
  toggleExpanded: (path: string) => void;
  isExpanded: (path: string) => boolean;
  createNoteInSelection: (name: string) => Promise<void>;
  createDrawioInSelection: (name: string) => Promise<void>;
  createFolderInSelection: (name: string) => Promise<void>;
  moveTreeEntry: (from: string, toParent: string, toIndex: number) => Promise<void>;
  renameTreeEntry: (from: string, nextName: string) => Promise<void>;
  removePath: (path: string) => Promise<void>;
  markExternalWrite: () => void;
};

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
  path: string,
  content: string,
  tabs: EditorTab[],
) {
  set({
    tabs,
    activePath: path,
    content,
    dirty: false,
    loading: false,
    selectedFolderPath: parentPath(path),
    selectedFolderExplicit: false,
  });
}

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  tree: null,
  tabs: [],
  activePath: null,
  selectedFolderPath: "",
  selectedFolderExplicit: false,
  expandedPaths: [],
  content: "",
  viewMode: "live",
  dirty: false,
  saving: false,
  loading: false,
  error: null,
  suppressWatchUntil: 0,

  openVaultAt: async (path) => {
    set({ loading: true, error: null });
    try {
      const tree = await openVault(path);
      const expandedPaths = await loadExpandedPaths(path);
      const session = await loadVaultSession(path);
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

  refreshTree: async () => {
    try {
      const tree = await listTree();
      set({ tree });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  openNote: async (path, options) => {
    const asPreview = options?.preview !== false;
    const { dirty, activePath, saveActive, tabs } = get();

    if (dirty && activePath) {
      await saveActive();
    }

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
      set({ loading: true, error: null });
      try {
        const content = await readNote(path);
        activateLoaded(set, path, content, nextTabs);
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
      let nextTabs = [...tabs];

      if (asPreview) {
        const previewIdx = nextTabs.findIndex((t) => t.preview);
        const tab: EditorTab = { path, preview: true };
        if (previewIdx >= 0) {
          nextTabs[previewIdx] = tab;
        } else {
          nextTabs.push(tab);
        }
      } else {
        nextTabs.push({ path, preview: false });
      }

      activateLoaded(set, path, content, nextTabs);
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

  closeTab: async (path) => {
    const { tabs, activePath, dirty, saveActive } = get();
    if (dirty && activePath === path) {
      await saveActive();
    }

    const index = tabs.findIndex((t) => t.path === path);
    if (index < 0) return;
    const nextTabs = tabs.filter((t) => t.path !== path);

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

    set({ loading: true, tabs: nextTabs });
    try {
      const content = await readNote(fallback.path);
      activateLoaded(set, fallback.path, content, nextTabs);
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
    const { activePath, tabs } = get();
    const patch: Partial<VaultStore> = { content, dirty: true };
    if (activePath) {
      const tab = tabs.find((t) => t.path === activePath);
      if (tab?.preview) {
        patch.tabs = tabs.map((t) =>
          t.path === activePath ? { ...t, preview: false } : t,
        );
      }
    }
    set(patch);
    if (patch.tabs) persistSession(get());
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleViewMode: () => {
    const { viewMode } = get();
    set({ viewMode: viewMode === "live" ? "source" : "live" });
  },

  saveActive: async () => {
    const { activePath, content, dirty } = get();
    if (!activePath || !dirty) return;
    set({ saving: true, suppressWatchUntil: Date.now() + 1200 });
    try {
      await writeNote(activePath, content);
      set({ dirty: false, saving: false });
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
          set({ content, dirty: false });
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
          set({ content, dirty: false });
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
        set({ loading: true, tabs: nextTabs });
        try {
          const content = await readNote(fallback.path);
          activateLoaded(set, fallback.path, content, nextTabs);
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

  markExternalWrite: () => set({ suppressWatchUntil: Date.now() + 1200 }),
}));

export { tabLabel };

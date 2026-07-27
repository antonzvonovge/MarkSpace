import { create } from "zustand";
import type { TreeNode } from "../lib/vaultApi";
import {
  createNote,
  deletePath,
  listTree,
  openVault,
  readNote,
  writeNote,
} from "../lib/vaultApi";

type VaultStore = {
  vaultPath: string | null;
  tree: TreeNode | null;
  activePath: string | null;
  content: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string | null;
  suppressWatchUntil: number;
  openVaultAt: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
  setContent: (content: string) => void;
  saveActive: () => Promise<void>;
  createAndOpenNote: (path: string) => Promise<void>;
  removePath: (path: string) => Promise<void>;
  markExternalWrite: () => void;
};

export const useVaultStore = create<VaultStore>((set, get) => ({
  vaultPath: null,
  tree: null,
  activePath: null,
  content: "",
  dirty: false,
  saving: false,
  loading: false,
  error: null,
  suppressWatchUntil: 0,

  openVaultAt: async (path) => {
    set({ loading: true, error: null });
    try {
      const tree = await openVault(path);
      set({
        vaultPath: path,
        tree,
        loading: false,
        activePath: null,
        content: "",
        dirty: false,
      });

      const welcome =
        tree.children?.find((c) => c.path === "Welcome.md") ??
        tree.children?.find((c) => !c.isDir);
      if (welcome) {
        await get().openNote(welcome.path);
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

  openNote: async (path) => {
    const { dirty, activePath, saveActive } = get();
    if (dirty && activePath) {
      await saveActive();
    }
    set({ loading: true, error: null });
    try {
      const content = await readNote(path);
      set({
        activePath: path,
        content,
        dirty: false,
        loading: false,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setContent: (content) => set({ content, dirty: true }),

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

  createAndOpenNote: async (path) => {
    try {
      const created = await createNote(path);
      await get().refreshTree();
      await get().openNote(created);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  removePath: async (path) => {
    try {
      await deletePath(path);
      const { activePath } = get();
      if (activePath === path || activePath?.startsWith(`${path}/`)) {
        set({ activePath: null, content: "", dirty: false });
      }
      await get().refreshTree();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  markExternalWrite: () => set({ suppressWatchUntil: Date.now() + 1200 }),
}));

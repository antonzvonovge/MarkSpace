import { create } from "zustand";
import {
  addAgentMemory,
  clearAgentMemory,
  deleteAgentMemory,
  getAgentMemory,
  setAgentMemoryEnabled,
  updateAgentMemory,
  type AgentMemoryDoc,
  type AgentMemoryEntry,
  type ClearAgentMemoryKind,
} from "../lib/vaultApi";

const EMPTY_DOC: AgentMemoryDoc = {
  version: 1,
  enabled: true,
  entries: [],
};

type AgentMemoryStore = {
  vaultPath: string | null;
  doc: AgentMemoryDoc;
  hydrated: boolean;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  add: (text: string, projectPath?: string | null) => Promise<AgentMemoryEntry>;
  update: (
    id: string,
    text: string,
    projectPath?: string | null,
  ) => Promise<AgentMemoryEntry>;
  remove: (id: string) => Promise<void>;
  clear: (kind: ClearAgentMemoryKind, project?: string | null) => Promise<void>;
};

export const useAgentMemoryStore = create<AgentMemoryStore>((set, get) => ({
  vaultPath: null,
  doc: EMPTY_DOC,
  hydrated: false,

  hydrateForVault: async (vaultPath) => {
    if (!vaultPath) {
      set({ vaultPath: null, doc: EMPTY_DOC, hydrated: true });
      return;
    }
    try {
      const doc = await getAgentMemory();
      set({ vaultPath, doc, hydrated: true });
    } catch {
      set({ vaultPath, doc: EMPTY_DOC, hydrated: true });
    }
  },

  refresh: async () => {
    if (!get().vaultPath) return;
    try {
      const doc = await getAgentMemory();
      set({ doc });
    } catch {
      /* keep current */
    }
  },

  setEnabled: async (enabled) => {
    const doc = await setAgentMemoryEnabled(enabled);
    set({ doc });
  },

  add: async (text, projectPath) => {
    const entry = await addAgentMemory(text, projectPath);
    await get().refresh();
    return entry;
  },

  update: async (id, text, projectPath) => {
    const entry = await updateAgentMemory(id, text, projectPath);
    await get().refresh();
    return entry;
  },

  remove: async (id) => {
    await deleteAgentMemory(id);
    await get().refresh();
  },

  clear: async (kind, project) => {
    const doc = await clearAgentMemory(kind, project);
    set({ doc });
  },
}));

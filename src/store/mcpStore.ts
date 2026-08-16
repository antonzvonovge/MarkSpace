import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  EMPTY_MCP_DOC,
  normalizeMcpServerConfig,
  type McpDoc,
  type McpServerConfig,
  type McpServerSnapshot,
} from "../ai/mcpTypes";
import {
  MCP_STATUS_EVENT,
  mcpGetVault,
  mcpListSnapshot,
  mcpReload,
  mcpReloadServer,
  mcpSetVault,
  mcpSync,
  normalizeSnapshots,
} from "../lib/mcpApi";
import {
  loadGlobalMcpDoc,
  saveGlobalMcpServers,
} from "../lib/mcpSettingsStore";

type McpStore = {
  vaultPath: string | null;
  globalServers: McpServerConfig[];
  vaultServers: McpServerConfig[];
  snapshots: McpServerSnapshot[];
  hydrated: boolean;
  reloading: boolean;
  reloadingId: string | null;
  hydrate: () => Promise<void>;
  hydrateForVault: (vaultPath: string | null) => Promise<void>;
  setGlobalServers: (servers: McpServerConfig[]) => Promise<void>;
  setVaultServers: (servers: McpServerConfig[]) => Promise<void>;
  reloadAll: () => Promise<void>;
  reloadServer: (id: string) => Promise<void>;
  applySnapshots: (snapshots: McpServerSnapshot[]) => void;
};

let statusUnlisten: (() => void) | null = null;

async function ensureStatusListener(
  apply: (snapshots: McpServerSnapshot[]) => void,
) {
  if (statusUnlisten) return;
  statusUnlisten = await listen<unknown>(MCP_STATUS_EVENT, (event) => {
    apply(normalizeSnapshots(event.payload));
  });
}

async function pushSync(
  globalServers: McpServerConfig[],
): Promise<McpServerSnapshot[]> {
  try {
    return await mcpSync(globalServers);
  } catch {
    return [];
  }
}

export const useMcpStore = create<McpStore>((set, get) => ({
  vaultPath: null,
  globalServers: [],
  vaultServers: [],
  snapshots: [],
  hydrated: false,
  reloading: false,
  reloadingId: null,

  applySnapshots: (snapshots) => set({ snapshots }),

  hydrate: async () => {
    await ensureStatusListener((snapshots) =>
      get().applySnapshots(snapshots),
    );
    const global = await loadGlobalMcpDoc();
    set({ globalServers: global.mcpServers, hydrated: true });
    const snapshots = await pushSync(global.mcpServers);
    if (snapshots.length > 0 || get().snapshots.length === 0) {
      set({ snapshots });
    }
  },

  hydrateForVault: async (vaultPath) => {
    await ensureStatusListener((snapshots) =>
      get().applySnapshots(snapshots),
    );
    if (!vaultPath) {
      set({ vaultPath: null, vaultServers: [] });
      const snapshots = await pushSync(get().globalServers);
      set({ snapshots });
      return;
    }
    let vaultDoc: McpDoc = EMPTY_MCP_DOC;
    try {
      vaultDoc = await mcpGetVault();
    } catch {
      vaultDoc = EMPTY_MCP_DOC;
    }
    set({ vaultPath, vaultServers: vaultDoc.mcpServers });
    const snapshots = await pushSync(get().globalServers);
    set({ snapshots });
  },

  setGlobalServers: async (servers) => {
    const cleaned = servers
      .map((s) => normalizeMcpServerConfig(s))
      .filter((s): s is McpServerConfig => Boolean(s));
    const saved = await saveGlobalMcpServers(cleaned);
    set({ globalServers: saved.mcpServers });
    const snapshots = await pushSync(saved.mcpServers);
    set({ snapshots });
  },

  setVaultServers: async (servers) => {
    if (!get().vaultPath) return;
    const cleaned = servers
      .map((s) => normalizeMcpServerConfig(s))
      .filter((s): s is McpServerConfig => Boolean(s));
    const saved = await mcpSetVault(cleaned);
    set({ vaultServers: saved.mcpServers });
    const snapshots = await mcpListSnapshot().catch(() => get().snapshots);
    set({ snapshots });
  },

  reloadAll: async () => {
    set({ reloading: true });
    try {
      const snapshots = await mcpReload();
      set({ snapshots });
    } finally {
      set({ reloading: false });
    }
  },

  reloadServer: async (id) => {
    set({ reloadingId: id });
    try {
      const snapshots = await mcpReloadServer(id);
      set({ snapshots });
    } finally {
      set({ reloadingId: null });
    }
  },
}));

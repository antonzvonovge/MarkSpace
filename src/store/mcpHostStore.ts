/** MarkSpace MCP host settings + runtime status. */

import { create } from "zustand";
import {
  mcpHostGetStatus,
  mcpHostStart,
  mcpHostStop,
  type McpHostStatus,
} from "../lib/mcpHostApi";
import {
  createDefaultMcpHostConfig,
  loadMcpHostConfig,
  mcpHostCursorSnippet,
  regenerateMcpHostToken,
  saveMcpHostConfig,
  type McpHostConfig,
} from "../lib/mcpHostSettingsStore";
import {
  startMcpHostBridge,
  stopMcpHostBridge,
} from "../ai/tasks/mcpHostBridge";

type McpHostStore = {
  config: McpHostConfig;
  status: McpHostStatus | null;
  hydrated: boolean;
  busy: boolean;
  hydrate: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  /** Apply config + bridge/stop host & bridge based on vault. */
  syncForVault: (vaultOpen: boolean) => Promise<void>;
  setEnabled: (enabled: boolean, vaultOpen: boolean) => Promise<void>;
  setPort: (port: number, vaultOpen: boolean) => Promise<void>;
  regenerateToken: (vaultOpen: boolean) => Promise<void>;
  cursorSnippet: () => string;
};

const emptyStatus = (): McpHostStatus => ({
  enabled: false,
  listening: false,
  bridgeReady: false,
  port: 17832,
  url: "http://127.0.0.1:17832/mcp",
  tokenSet: false,
  error: null,
});

export const useMcpHostStore = create<McpHostStore>((set, get) => ({
  config: createDefaultMcpHostConfig(),
  status: null,
  hydrated: false,
  busy: false,

  hydrate: async () => {
    const config = await loadMcpHostConfig();
    set({ config, hydrated: true });
    try {
      const status = await mcpHostGetStatus();
      set({ status });
    } catch {
      set({ status: emptyStatus() });
    }
  },

  refreshStatus: async () => {
    try {
      const status = await mcpHostGetStatus();
      set({ status });
    } catch {
      /* ignore */
    }
  },

  syncForVault: async (vaultOpen) => {
    const { config } = get();
    set({ busy: true });
    try {
      if (vaultOpen) {
        await startMcpHostBridge();
        if (config.enabled) {
          const status = await mcpHostStart({
            port: config.port,
            token: config.token,
          });
          set({ status });
        } else {
          const status = await mcpHostStop();
          set({ status });
        }
      } else {
        await stopMcpHostBridge();
        const status = await mcpHostStop();
        set({ status });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({
        status: {
          ...(get().status ?? emptyStatus()),
          error: message,
          listening: false,
        },
      });
    } finally {
      set({ busy: false });
    }
  },

  setEnabled: async (enabled, vaultOpen) => {
    const next = await saveMcpHostConfig({ ...get().config, enabled });
    set({ config: next });
    await get().syncForVault(vaultOpen);
  },

  setPort: async (port, vaultOpen) => {
    const next = await saveMcpHostConfig({ ...get().config, port });
    set({ config: next });
    await get().syncForVault(vaultOpen);
  },

  regenerateToken: async (vaultOpen) => {
    const next = await saveMcpHostConfig(
      regenerateMcpHostToken(get().config),
    );
    set({ config: next });
    await get().syncForVault(vaultOpen);
  },

  cursorSnippet: () => mcpHostCursorSnippet(get().config),
}));

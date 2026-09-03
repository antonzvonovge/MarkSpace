/** Persist MarkSpace MCP host settings in settings.json. */

import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";
const KEY = "mcpHost";

export const MCP_HOST_DEFAULT_PORT = 17832;

export type McpHostConfig = {
  enabled: boolean;
  port: number;
  token: string;
};

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createDefaultMcpHostConfig(): McpHostConfig {
  return {
    enabled: false,
    port: MCP_HOST_DEFAULT_PORT,
    token: newToken(),
  };
}

export function normalizeMcpHostConfig(raw: unknown): McpHostConfig {
  const defaults = createDefaultMcpHostConfig();
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Record<string, unknown>;
  const port =
    typeof o.port === "number" && Number.isFinite(o.port) && o.port > 0
      ? Math.floor(o.port)
      : defaults.port;
  const token =
    typeof o.token === "string" && o.token.trim().length >= 8
      ? o.token.trim()
      : defaults.token;
  return {
    enabled: o.enabled === true,
    port: Math.min(65535, Math.max(1024, port)),
    token,
  };
}

export async function loadMcpHostConfig(): Promise<McpHostConfig> {
  const store = await Store.load(STORE_FILE);
  const raw = await store.get(KEY);
  return normalizeMcpHostConfig(raw);
}

export async function saveMcpHostConfig(
  config: McpHostConfig,
): Promise<McpHostConfig> {
  const store = await Store.load(STORE_FILE);
  const normalized = normalizeMcpHostConfig(config);
  await store.set(KEY, normalized);
  await store.save();
  return normalized;
}

export function regenerateMcpHostToken(config: McpHostConfig): McpHostConfig {
  return { ...config, token: newToken() };
}

export function mcpHostCursorSnippet(config: McpHostConfig): string {
  const url = `http://127.0.0.1:${config.port}/mcp`;
  return JSON.stringify(
    {
      mcpServers: {
        markspace: {
          url,
          headers: {
            Authorization: `Bearer ${config.token}`,
          },
        },
      },
    },
    null,
    2,
  );
}

import { Store } from "@tauri-apps/plugin-store";
import {
  EMPTY_MCP_DOC,
  normalizeMcpDoc,
  type McpDoc,
  type McpServerConfig,
} from "../ai/mcpTypes";

const STORE_FILE = "settings.json";
const MCP_KEY = "mcp";

export async function loadGlobalMcpDoc(): Promise<McpDoc> {
  const store = await Store.load(STORE_FILE);
  const raw = await store.get(MCP_KEY);
  return normalizeMcpDoc(raw);
}

export async function saveGlobalMcpDoc(doc: McpDoc): Promise<McpDoc> {
  const store = await Store.load(STORE_FILE);
  const normalized = normalizeMcpDoc(doc);
  await store.set(MCP_KEY, {
    version: 1,
    mcpServers: normalized.mcpServers,
  });
  await store.save();
  return normalized;
}

export async function saveGlobalMcpServers(
  servers: McpServerConfig[],
): Promise<McpDoc> {
  return saveGlobalMcpDoc({ version: 1, mcpServers: servers });
}

export { EMPTY_MCP_DOC };

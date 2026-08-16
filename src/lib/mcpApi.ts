import { invoke } from "@tauri-apps/api/core";
import {
  EMPTY_MCP_DOC,
  normalizeMcpDoc,
  normalizeMcpServerConfig,
  type McpDoc,
  type McpServerConfig,
  type McpServerSnapshot,
  type McpStatus,
} from "../ai/mcpTypes";

export const MCP_STATUS_EVENT = "mcp://status";

function asSnapshot(raw: unknown): McpServerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const cfg = normalizeMcpServerConfig(obj);
  if (!cfg) return null;
  const scope = obj.scope === "vault" ? "vault" : "global";
  const status: McpStatus =
    obj.status === "connecting" ||
    obj.status === "connected" ||
    obj.status === "failed" ||
    obj.status === "disabled"
      ? obj.status
      : "disabled";
  const tools = Array.isArray(obj.tools)
    ? obj.tools
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          name: String(t.name ?? ""),
          description: String(t.description ?? ""),
          inputSchema: t.inputSchema,
        }))
        .filter((t) => t.name)
    : [];
  return {
    ...cfg,
    scope,
    status,
    error: typeof obj.error === "string" ? obj.error : null,
    tools,
  };
}

export function normalizeSnapshots(raw: unknown): McpServerSnapshot[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(asSnapshot).filter((s): s is McpServerSnapshot => Boolean(s));
}

export async function mcpListSnapshot(): Promise<McpServerSnapshot[]> {
  const raw = await invoke<unknown>("mcp_list_snapshot");
  return normalizeSnapshots(raw);
}

export async function mcpSync(
  globalServers: McpServerConfig[],
): Promise<McpServerSnapshot[]> {
  const raw = await invoke<unknown>("mcp_sync", {
    args: { globalServers },
  });
  return normalizeSnapshots(raw);
}

export async function mcpGetVault(): Promise<McpDoc> {
  const raw = await invoke<unknown>("mcp_get_vault");
  return normalizeMcpDoc(raw);
}

export async function mcpSetVault(
  servers: McpServerConfig[],
): Promise<McpDoc> {
  const raw = await invoke<unknown>("mcp_set_vault", {
    args: { servers },
  });
  return normalizeMcpDoc(raw ?? EMPTY_MCP_DOC);
}

export async function mcpReload(): Promise<McpServerSnapshot[]> {
  const raw = await invoke<unknown>("mcp_reload");
  return normalizeSnapshots(raw);
}

export async function mcpReloadServer(id: string): Promise<McpServerSnapshot[]> {
  const raw = await invoke<unknown>("mcp_reload_server", {
    args: { id },
  });
  return normalizeSnapshots(raw);
}

export async function mcpCallTool(
  serverId: string,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  return invoke("mcp_call_tool", {
    args: {
      serverId,
      toolName,
      arguments: args ?? {},
    },
  });
}

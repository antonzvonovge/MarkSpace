/** Tauri invoke wrappers for the MarkSpace MCP host (outbound server). */

import { invoke } from "@tauri-apps/api/core";

export type McpHostToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpHostStatus = {
  enabled: boolean;
  listening: boolean;
  bridgeReady: boolean;
  port: number;
  url: string;
  tokenSet: boolean;
  error: string | null;
};

export type McpHostCallEvent = {
  requestId: string;
  name: string;
  arguments: unknown;
};

export async function mcpHostGetStatus(): Promise<McpHostStatus> {
  return invoke("mcp_host_get_status");
}

export async function mcpHostStart(opts: {
  port: number;
  token: string;
}): Promise<McpHostStatus> {
  return invoke("mcp_host_start", { port: opts.port, token: opts.token });
}

export async function mcpHostStop(): Promise<McpHostStatus> {
  return invoke("mcp_host_stop");
}

export async function mcpHostRegisterTools(
  tools: McpHostToolDef[],
): Promise<void> {
  await invoke("mcp_host_register_tools", { tools });
}

export async function mcpHostSetBridgeReady(ready: boolean): Promise<void> {
  await invoke("mcp_host_set_bridge_ready", { ready });
}

export async function mcpHostToolResult(opts: {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}): Promise<void> {
  await invoke("mcp_host_tool_result", {
    requestId: opts.requestId,
    ok: opts.ok,
    result: opts.result ?? null,
    error: opts.error ?? null,
  });
}

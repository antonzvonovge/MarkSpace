/**
 * Frontend bridge for the MarkSpace MCP host: listens for tool calls from Rust
 * and executes them via shared task ops.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TASK_MCP_TOOL_DEFS, dispatchTaskTool } from "./ops";
import {
  mcpHostRegisterTools,
  mcpHostSetBridgeReady,
  mcpHostToolResult,
  type McpHostCallEvent,
} from "../../lib/mcpHostApi";

const EVENT_CALL = "mcp-host://call";

let unlisten: UnlistenFn | null = null;
let started = false;

export async function startMcpHostBridge(): Promise<void> {
  if (started) return;

  await mcpHostRegisterTools(TASK_MCP_TOOL_DEFS);

  unlisten = await listen<McpHostCallEvent>(EVENT_CALL, (event) => {
    const payload = event.payload;
    if (!payload?.requestId || !payload.name) return;
    void (async () => {
      try {
        const result = await dispatchTaskTool(
          payload.name,
          payload.arguments ?? {},
        );
        await mcpHostToolResult({
          requestId: payload.requestId,
          ok: true,
          result,
        });
      } catch (e) {
        await mcpHostToolResult({
          requestId: payload.requestId,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });

  await mcpHostSetBridgeReady(true);
  started = true;
}

export async function stopMcpHostBridge(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  started = false;
  try {
    await mcpHostSetBridgeReady(false);
  } catch {
    // Host may already be torn down.
  }
}

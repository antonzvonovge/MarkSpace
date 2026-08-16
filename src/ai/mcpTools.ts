import { jsonSchema, tool, type JSONSchema7, type Tool } from "ai";
import {
  mcpCallTool,
} from "../lib/mcpApi";
import { useMcpStore } from "../store/mcpStore";
import {
  mcpServerMatchesRole,
  sanitizeMcpToolId,
  type McpServerSnapshot,
} from "./mcpTypes";
import { specialistLabel, type SpecialistKind } from "./toolPacks";

export type McpToolRole = "orchestrator" | SpecialistKind;

function asJsonSchema(raw: unknown): JSONSchema7 {
  if (raw && typeof raw === "object") {
    const obj = { ...(raw as JSONSchema7) };
    if (!obj.type) obj.type = "object";
    return obj;
  }
  return { type: "object", additionalProperties: true };
}

export function connectedMcpServers(): McpServerSnapshot[] {
  return useMcpStore
    .getState()
    .snapshots.filter((s) => s.status === "connected" && s.enabled);
}

export function mcpServersForRole(role: McpToolRole): McpServerSnapshot[] {
  return connectedMcpServers().filter((s) => mcpServerMatchesRole(s, role));
}

export function mcpCacheKey(role: McpToolRole | "ask"): string {
  if (role === "ask") return "ask";
  return mcpServersForRole(role)
    .map((s) => `${s.id}:${s.tools.map((t) => t.name).join(",")}`)
    .sort()
    .join("|");
}

export function buildMcpTools(role: McpToolRole): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const server of mcpServersForRole(role)) {
    for (const def of server.tools) {
      const id = sanitizeMcpToolId(server.id, def.name);
      const description = [
        def.description.trim() || `MCP tool ${def.name}`,
        `(MCP server: ${server.id})`,
      ].join(" ");
      const toolName = def.name;
      const serverId = server.id;
      out[id] = tool({
        description,
        inputSchema: jsonSchema(asJsonSchema(def.inputSchema)),
        execute: async (args: unknown) => {
          try {
            return await mcpCallTool(serverId, toolName, args ?? {});
          } catch (error) {
            return {
              isError: true,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      });
    }
  }
  return out;
}

function formatUseIn(server: McpServerSnapshot): string {
  if (server.useIn === "always") return "always (parent Agent)";
  const labels = server.useIn.map((k) => specialistLabel(k)).join(", ");
  return `via ${labels} specialist`;
}

export function formatMcpOrchestratorPromptLines(): string[] {
  const live = connectedMcpServers();
  if (live.length === 0) return [];
  const always = live.filter((s) => s.useIn === "always");
  const delegated = live.filter((s) => s.useIn !== "always");
  const lines = [
    "MCP servers currently connected (only these are callable; ignore any others the user may mention):",
  ];
  if (always.length > 0) {
    lines.push(
      "Always-on MCP tools (call them yourself, do not delegate):",
    );
    for (const server of always) {
      const tools = server.tools
        .map((t) => sanitizeMcpToolId(server.id, t.name))
        .join(", ");
      lines.push(`- ${server.id}: ${tools || "(no tools)"}`);
    }
  }
  if (delegated.length > 0) {
    lines.push(
      "Specialist-only MCP: you do not have these tools. Delegate with run_specialist using the matching kind.",
    );
    for (const server of delegated) {
      lines.push(
        `- ${server.id} (${formatUseIn(server)}): ${server.tools.map((t) => t.name).join(", ") || "(no tools)"}`,
      );
    }
  }
  return lines;
}

export function formatMcpWorkerPromptLines(kind: SpecialistKind): string[] {
  const live = mcpServersForRole(kind);
  if (live.length === 0) return [];
  const lines = [
    "Connected MCP tools for this specialist (call them directly):",
  ];
  for (const server of live) {
    const tools = server.tools
      .map((t) => sanitizeMcpToolId(server.id, t.name))
      .join(", ");
    lines.push(`- ${server.id}: ${tools || "(no tools)"}`);
  }
  return lines;
}

export function mcpToolNamesForRole(role: McpToolRole): string[] {
  return Object.keys(buildMcpTools(role));
}

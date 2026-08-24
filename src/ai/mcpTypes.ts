import {
  SPECIALIST_KIND_ORDER,
  type SpecialistKind,
} from "./toolPacks";

export type McpScope = "global" | "vault";

export type McpStatus = "connecting" | "connected" | "failed" | "disabled";

export type McpUseIn = "always" | SpecialistKind[];

export type McpServerConfig = {
  id: string;
  enabled: boolean;
  useIn: McpUseIn;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
};

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type McpServerSnapshot = McpServerConfig & {
  scope: McpScope;
  status: McpStatus;
  error?: string | null;
  tools: McpToolInfo[];
};

export type McpDoc = {
  version: number;
  mcpServers: McpServerConfig[];
};

export const EMPTY_MCP_DOC: McpDoc = { version: 1, mcpServers: [] };

export const MCP_SPECIALIST_OPTIONS: { value: SpecialistKind; label: string }[] =
  [
    { value: "research", label: "Research" },
    { value: "edit_notes", label: "Editor" },
    { value: "diagram", label: "Diagram" },
    { value: "links", label: "Links" },
    { value: "dict", label: "Dictionary" },
    { value: "habits", label: "Habits" },
    { value: "courses", label: "Courses" },
    { value: "terminal", label: "Terminal" },
  ];

const KIND_SET = new Set<string>(SPECIALIST_KIND_ORDER);

export function isSpecialistKindList(value: unknown): value is SpecialistKind[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && KIND_SET.has(item))
  );
}

export function normalizeUseIn(raw: unknown): McpUseIn {
  if (raw === "always" || raw == null) return "always";
  if (typeof raw === "string" && raw.trim().toLowerCase() === "always") {
    return "always";
  }
  if (Array.isArray(raw)) {
    const kinds: SpecialistKind[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const kind = item.trim();
      if (!KIND_SET.has(kind)) continue;
      if (!kinds.includes(kind as SpecialistKind)) {
        kinds.push(kind as SpecialistKind);
      }
    }
    return kinds.length > 0 ? kinds : "always";
  }
  return "always";
}

function recordOfStrings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k || typeof value !== "string") continue;
    out[k] = value;
  }
  return out;
}

export function isSafeMcpId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id.trim());
}

export function emptyMcpServerConfig(id = ""): McpServerConfig {
  return {
    id,
    enabled: true,
    useIn: "always",
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
  };
}

export function normalizeMcpServerConfig(
  raw: Partial<McpServerConfig> | null | undefined,
  fallbackId = "",
): McpServerConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id ?? fallbackId).trim();
  if (!isSafeMcpId(id)) return null;
  const command =
    typeof raw.command === "string" ? raw.command.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (!command && !url) return null;
  const args = Array.isArray(raw.args)
    ? raw.args
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return {
    id,
    enabled: raw.enabled !== false,
    useIn: normalizeUseIn(raw.useIn),
    command: command || undefined,
    args,
    env: recordOfStrings(raw.env),
    url: url || undefined,
    headers: recordOfStrings(raw.headers),
  };
}

export function normalizeMcpDoc(raw: unknown): McpDoc {
  if (!raw || typeof raw !== "object") return { ...EMPTY_MCP_DOC };
  const obj = raw as Record<string, unknown>;
  const servers: McpServerConfig[] = [];
  const seen = new Set<string>();
  const push = (cfg: McpServerConfig | null) => {
    if (!cfg || seen.has(cfg.id) || servers.length >= 32) return;
    seen.add(cfg.id);
    servers.push(cfg);
  };
  if (Array.isArray(obj.mcpServers)) {
    for (const item of obj.mcpServers) {
      push(normalizeMcpServerConfig(item as Partial<McpServerConfig>));
    }
  } else if (obj.mcpServers && typeof obj.mcpServers === "object") {
    for (const [id, item] of Object.entries(
      obj.mcpServers as Record<string, unknown>,
    )) {
      push(
        normalizeMcpServerConfig(item as Partial<McpServerConfig>, id),
      );
    }
  } else if (Array.isArray(obj.servers)) {
    for (const item of obj.servers) {
      push(normalizeMcpServerConfig(item as Partial<McpServerConfig>));
    }
  }
  return { version: 1, mcpServers: servers };
}

export function mcpServerMatchesRole(
  server: Pick<McpServerConfig, "useIn">,
  role: "orchestrator" | SpecialistKind,
): boolean {
  if (server.useIn === "always") return role === "orchestrator";
  if (role === "orchestrator") return false;
  return server.useIn.includes(role);
}

export function sanitizeMcpToolId(serverId: string, toolName: string): string {
  const raw = `mcp_${serverId}_${toolName}`;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return cleaned.slice(0, 128) || "mcp_tool";
}

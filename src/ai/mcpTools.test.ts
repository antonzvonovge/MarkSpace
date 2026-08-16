import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { useMcpStore } from "../store/mcpStore";
import {
  buildMcpTools,
  formatMcpOrchestratorPromptLines,
  formatMcpWorkerPromptLines,
} from "./mcpTools";
import { buildSystemPrompt, buildVaultTools } from "./vaultTools";
import type { McpServerSnapshot } from "./mcpTypes";

function snap(
  partial: Partial<McpServerSnapshot> & Pick<McpServerSnapshot, "id">,
): McpServerSnapshot {
  return {
    enabled: true,
    useIn: "always",
    args: [],
    env: {},
    headers: {},
    command: "npx",
    scope: "global",
    status: "connected",
    tools: [
      {
        name: "ping",
        description: "Ping the service",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    ...partial,
  };
}

describe("MCP tool filtering", () => {
  beforeEach(() => {
    useMcpStore.setState({
      snapshots: [],
      globalServers: [],
      vaultServers: [],
    });
  });

  afterEach(() => {
    useMcpStore.setState({
      snapshots: [],
      globalServers: [],
      vaultServers: [],
    });
  });

  it("keeps Failed and Disabled out of the model tool map", () => {
    useMcpStore.setState({
      snapshots: [
        snap({ id: "live" }),
        snap({ id: "down", status: "failed" }),
        snap({ id: "off", enabled: false, status: "disabled" }),
        snap({ id: "wait", status: "connecting" }),
      ],
    });
    const agent = buildVaultTools("agent");
    const ids = Object.keys(agent);
    expect(ids).toContain("mcp_live_ping");
    expect(ids).not.toContain("mcp_down_ping");
    expect(ids).not.toContain("mcp_off_ping");
    expect(ids).not.toContain("mcp_wait_ping");
    expect(Object.keys(buildMcpTools("orchestrator"))).toEqual(["mcp_live_ping"]);
  });

  it("does not add MCP tools in Ask mode", () => {
    useMcpStore.setState({ snapshots: [snap({ id: "live" })] });
    const ask = buildVaultTools("ask");
    expect(Object.keys(ask)).not.toContain("mcp_live_ping");
  });

  it("routes specialist-only servers to those workers", () => {
    useMcpStore.setState({
      snapshots: [
        snap({
          id: "gh",
          useIn: ["research"],
        }),
      ],
    });
    const parent = buildVaultTools("agent");
    expect(Object.keys(parent)).not.toContain("mcp_gh_ping");
    const research = buildVaultTools("agent", {
      toolNames: ["read_note"],
      specialistKind: "research",
    });
    expect(Object.keys(research)).toContain("mcp_gh_ping");
    expect(Object.keys(research)).toContain("read_note");
    const diagram = buildVaultTools("agent", {
      toolNames: ["read_diagram"],
      specialistKind: "diagram",
    });
    expect(Object.keys(diagram)).not.toContain("mcp_gh_ping");
  });
});

describe("MCP prompt hints", () => {
  beforeEach(() => {
    useMcpStore.setState({ snapshots: [] });
  });

  afterEach(() => {
    useMcpStore.setState({ snapshots: [] });
  });

  it("lists always-on tools for the orchestrator and delegate hints for specialists", () => {
    useMcpStore.setState({
      snapshots: [
        snap({ id: "always_srv" }),
        snap({
          id: "research_srv",
          useIn: ["research"],
        }),
        snap({ id: "dead", status: "failed" }),
      ],
    });
    const lines = formatMcpOrchestratorPromptLines();
    const text = lines.join("\n");
    expect(text).toContain("always_srv");
    expect(text).toContain("mcp_always_srv_ping");
    expect(text).toContain("research_srv");
    expect(text).toContain("run_specialist");
    expect(text).not.toContain("dead");
    expect(formatMcpWorkerPromptLines("research").join("\n")).toContain(
      "research_srv",
    );
    expect(formatMcpWorkerPromptLines("diagram")).toEqual([]);
  });

  it("injects live MCP lines into the Agent system prompt only", () => {
    useMcpStore.setState({
      snapshots: [snap({ id: "live" })],
    });
    const agent = buildSystemPrompt({
      mode: "agent",
      vaultPath: "/tmp/vault",
      activePath: null,
      activeExcerpt: null,
    });
    expect(agent).toContain("live");
    expect(agent).toContain("mcp_live_ping");
    const ask = buildSystemPrompt({
      mode: "ask",
      vaultPath: "/tmp/vault",
      activePath: null,
      activeExcerpt: null,
    });
    expect(ask).not.toContain("mcp_live_ping");
  });
});

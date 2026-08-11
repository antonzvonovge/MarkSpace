import { describe, expect, it } from "vitest";
import { formatForcedToolsLines, listChatTools } from "./toolCatalog";
import { ORCHESTRATOR_TOOL_NAMES } from "./toolPacks";

describe("listChatTools", () => {
  it("lists ask tools without agent-only writes", () => {
    const ask = listChatTools("ask");
    const ids = ask.map((t) => t.id);
    expect(ids).toContain("web_search");
    expect(ids).toContain("read_note");
    expect(ids).not.toContain("edit_note");
    expect(ask.every((t) => t.description.length > 0)).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("lists orchestrator tools in agent mode", () => {
    const agent = listChatTools("agent");
    const ids = agent.map((t) => t.id);
    expect(ids.sort()).toEqual([...ORCHESTRATOR_TOOL_NAMES].sort());
    expect(ids).toContain("run_specialist");
    expect(ids).toContain("search");
    expect(ids).toContain("memory");
    expect(ids).not.toContain("edit_note");
    expect(ids).not.toContain("web_search");
  });
});

describe("formatForcedToolsLines", () => {
  it("returns empty when no ids", () => {
    expect(formatForcedToolsLines([])).toEqual([]);
    expect(formatForcedToolsLines(null)).toEqual([]);
  });

  it("formats unique tool mentions", () => {
    const lines = formatForcedToolsLines(["web_search", "web_search", "read_note"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("@web_search");
    expect(lines[0]).toContain("@read_note");
    expect(lines[0]).toContain("Prefer calling them when relevant");
  });
});

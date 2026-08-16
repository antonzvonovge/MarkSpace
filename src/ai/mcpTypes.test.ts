import { describe, expect, it } from "vitest";
import {
  mcpServerMatchesRole,
  normalizeMcpDoc,
  normalizeUseIn,
  sanitizeMcpToolId,
} from "./mcpTypes";

describe("normalizeMcpDoc", () => {
  it("parses Cursor-style mcpServers map and vault override ids", () => {
    const doc = normalizeMcpDoc({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          useIn: ["research", "edit_notes"],
        },
        "bad id": { command: "npx" },
        empty: { enabled: true },
      },
    });
    expect(doc.mcpServers.map((s) => s.id).sort()).toEqual(["github"]);
    expect(doc.mcpServers[0]?.useIn).toEqual(["research", "edit_notes"]);
    expect(doc.mcpServers[0]?.enabled).toBe(true);
  });

  it("defaults useIn to always", () => {
    expect(normalizeUseIn(undefined)).toBe("always");
    expect(normalizeUseIn("ALWAYS")).toBe("always");
    expect(normalizeUseIn(["nope"])).toBe("always");
  });
});

describe("mcpServerMatchesRole", () => {
  it("always servers only go to the orchestrator", () => {
    expect(mcpServerMatchesRole({ useIn: "always" }, "orchestrator")).toBe(true);
    expect(mcpServerMatchesRole({ useIn: "always" }, "research")).toBe(false);
  });

  it("specialist servers only match selected kinds", () => {
    const useIn = ["research", "edit_notes"] as const;
    expect(mcpServerMatchesRole({ useIn: [...useIn] }, "orchestrator")).toBe(
      false,
    );
    expect(mcpServerMatchesRole({ useIn: [...useIn] }, "research")).toBe(true);
    expect(mcpServerMatchesRole({ useIn: [...useIn] }, "diagram")).toBe(false);
  });
});

describe("sanitizeMcpToolId", () => {
  it("prefixes and strips illegal characters", () => {
    expect(sanitizeMcpToolId("github", "list.issues")).toBe(
      "mcp_github_list_issues",
    );
  });
});

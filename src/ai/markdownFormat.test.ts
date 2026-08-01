import { describe, expect, it } from "vitest";
import {
  MARKDOWN_FORMAT_GUIDE,
  markdownCoreRules,
} from "./markdownFormat";

describe("markdownFormat", () => {
  it("has core-rules markers and a non-empty core block", () => {
    expect(MARKDOWN_FORMAT_GUIDE).toContain("<!-- core-rules:start -->");
    expect(MARKDOWN_FORMAT_GUIDE).toContain("<!-- core-rules:end -->");
    const rules = markdownCoreRules();
    expect(rules.length).toBeGreaterThanOrEqual(5);
    for (const rule of rules) {
      expect(rule.length).toBeGreaterThan(10);
      expect(rule.startsWith("- ")).toBe(false);
    }
  });

  it("documents each major dialect feature", () => {
    const guide = MARKDOWN_FORMAT_GUIDE;
    expect(guide).toContain("[[");
    expect(guide).toContain(".drawio");
    expect(guide).toContain(".assets/");
    expect(guide).toContain("mermaid");
    expect(guide).toContain("plantuml");
    expect(guide).toContain("data-background-color");
  });

  it("has a Not supported section", () => {
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Not supported/i);
  });
});

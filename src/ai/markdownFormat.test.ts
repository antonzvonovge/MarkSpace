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
    expect(guide).toContain("#multi-agent");
    expect(guide).toMatch(/##\s+Inline tags/i);
    expect(guide).toMatch(/##\s+Math/i);
    expect(guide).toContain("$Cl^-$");
  });

  it("has a Not supported section", () => {
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Not supported/i);
    expect(MARKDOWN_FORMAT_GUIDE).not.toMatch(
      /##\s+Not supported[\s\S]*Math \(`\$…\$`/,
    );
  });

  it("allows math in core rules", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/\$Cl\^-\$|Math:/i);
    expect(rules).not.toMatch(/unsupported syntax \(callouts, math/);
  });

  it("allows inline hashtags in core rules", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/inline tags/i);
    expect(rules).not.toMatch(/do \*\*not\*\* emit[\s\S]*inline `#tags`/i);
  });

  it("documents nested list indent rules in core and guide", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/Nested lists/i);
    expect(rules).toMatch(/2 spaces/i);
    expect(rules).toMatch(/3 spaces/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Lists/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain("  * nested");
    expect(MARKDOWN_FORMAT_GUIDE).toContain("   * nested");
  });
});

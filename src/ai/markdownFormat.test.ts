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
    expect(guide).toContain("marker:");
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

  it("forbids fake https://file.md vault links in core rules", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/https:\/\/Note\.md|https:\/\/file\.md/i);
    expect(rules).toMatch(/\[\[folder\/\[Note\.md\]/);
  });

  it("documents diary day markers in core rules", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/marker:/);
    expect(rules).toMatch(/holiday/);
  });

  it("documents Media library catalog cards in core rules and guide", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/Media library projects/i);
    expect(rules).toMatch(/kind/);
    expect(rules).toMatch(/genres/);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Media library catalog/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain("original_title");
    expect(MARKDOWN_FORMAT_GUIDE).toContain("kinopoisk_id");
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/\{year\}-\{title\}/);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/kind=`media`/);
  });

  it("documents blockquote marker spacing in core and guide", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/Blockquotes/i);
    expect(rules).toMatch(/>  /);
    expect(rules).toMatch(/exactly one/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/###\s+Blockquotes/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain("> **Goal:**");
  });

  it("documents nested list indent rules in core and guide", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/Nested lists/i);
    expect(rules).toMatch(/2 spaces/i);
    expect(rules).toMatch(/3 spaces/i);
    expect(rules).toMatch(/indented/i);
    expect(rules).toMatch(/flush-left|flush left/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Lists/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain("  * nested");
    expect(MARKDOWN_FORMAT_GUIDE).toContain("   * nested");
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/Bold labels in bullets/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain(
      "Indented paragraph — still part of this bullet",
    );
  });

  it("describes indentation as relative to the parent at any depth", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/relative to the parent/i);
    expect(rules).toMatch(/compounds/i);
    expect(rules).toMatch(/restarts numbering/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/text column/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/Deeper nesting/i);
    expect(MARKDOWN_FORMAT_GUIDE).toContain("        Continuation of that child");
  });

  it("forbids ASCII box tables in favor of GFM pipes", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/GFM pipe tables/i);
    expect(rules).toMatch(/ASCII|box-drawing/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/##\s+Tables/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/Do \*\*not\*\* draw tables with ASCII/i);
  });

  it("prefers mermaid/plantuml/drawio over ASCII diagrams", () => {
    const rules = markdownCoreRules().join("\n");
    expect(rules).toMatch(/mermaid/i);
    expect(rules).toMatch(/plantuml/i);
    expect(rules).toMatch(/\.drawio/i);
    expect(rules).toMatch(/d2/i);
    expect(rules).toMatch(/dot|graphviz/i);
    expect(rules).toMatch(/markmap/i);
    expect(rules).toMatch(/ASCII|box-drawing/i);
    expect(rules).toMatch(/subgraph id|quoted parentheses|double-quoted/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/Do \*\*not\*\* draw diagrams with ASCII/i);
    expect(MARKDOWN_FORMAT_GUIDE).toMatch(/Mermaid pitfalls/i);
  });
});

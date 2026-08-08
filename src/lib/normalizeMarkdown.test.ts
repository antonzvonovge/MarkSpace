import { describe, expect, it } from "vitest";
import { normalizeMarkdown } from "./normalizeMarkdown";

describe("normalizeMarkdown list continuations", () => {
  it("indents a flush paragraph between numbered siblings", () => {
    const input = [
      "1. **Topic A:**",
      "",
      "Flush body drops out.",
      "",
      "1. **Topic B:**",
      "",
      "Also flush.",
      "",
      "2. **Topic C:** already correct number but still sibling",
    ].join("\n");

    const out = normalizeMarkdown(input);
    expect(out).toBe(
      [
        "1. **Topic A:**",
        "",
        "   Flush body drops out.",
        "",
        "1. **Topic B:**",
        "",
        "   Also flush.",
        "",
        "2. **Topic C:** already correct number but still sibling",
      ].join("\n"),
    );
  });

  it("indents under nested bullets relative to the bullet text column", () => {
    const input = [
      "* Parent",
      "",
      "Flush under bullet.",
      "",
      "* Sibling",
    ].join("\n");

    expect(normalizeMarkdown(input)).toBe(
      ["* Parent", "", "  Flush under bullet.", "", "* Sibling"].join("\n"),
    );
  });

  it("compounds at deeper nesting (numbered → bullet → continuation)", () => {
    const input = [
      "1. Outer",
      "   * Inner",
      "",
      "   under-indented (3 spaces, need 5)",
      "",
      "   * Inner sibling",
      "2. Outer sibling",
    ].join("\n");

    expect(normalizeMarkdown(input)).toBe(
      [
        "1. Outer",
        "   * Inner",
        "",
        "     under-indented (3 spaces, need 5)",
        "",
        "   * Inner sibling",
        "2. Outer sibling",
      ].join("\n"),
    );
  });

  it("leaves a flush paragraph after the last list item alone", () => {
    const input = ["1. Only item", "", "Top-level after list."].join("\n");
    expect(normalizeMarkdown(input)).toBe(input);
  });

  it("does not pull a paragraph across a heading", () => {
    const input = [
      "1. Item",
      "",
      "Should stay top-level.",
      "",
      "## Heading",
      "",
      "1. New list",
    ].join("\n");
    expect(normalizeMarkdown(input)).toBe(input);
  });

  it("does not change correctly indented continuations", () => {
    const input = [
      "1. **Label:**",
      "",
      "   Already indented.",
      "   * Nested.",
      "2. Next",
    ].join("\n");
    expect(normalizeMarkdown(input)).toBe(input);
  });

  it("skips regions that contain a code fence", () => {
    const input = [
      "1. Item",
      "",
      "```",
      "code",
      "```",
      "",
      "2. Next",
    ].join("\n");
    expect(normalizeMarkdown(input)).toBe(input);
  });

  it("still heals flush bodies when nested bullets sit between siblings", () => {
    const input = [
      "1. **Graceful Escalation:**",
      "",
      "Start with a cheap model.",
      "",
      "   * Retry once or twice.",
      "   * Escalate on the third try.",
      "",
      "1. **History compression:**",
    ].join("\n");

    expect(normalizeMarkdown(input)).toBe(
      [
        "1. **Graceful Escalation:**",
        "",
        "   Start with a cheap model.",
        "",
        "   * Retry once or twice.",
        "   * Escalate on the third try.",
        "",
        "1. **History compression:**",
      ].join("\n"),
    );
  });

  it("does not modify YAML front-matter", () => {
    const input = [
      "---",
      "tags:",
      "  - work",
      "---",
      "1. A",
      "",
      "Body",
      "",
      "2. B",
    ].join("\n");

    expect(normalizeMarkdown(input)).toBe(
      [
        "---",
        "tags:",
        "  - work",
        "---",
        "1. A",
        "",
        "   Body",
        "",
        "2. B",
      ].join("\n"),
    );
  });

  it("never decreases indent", () => {
    const input = [
      "1. Item",
      "",
      "      over-indented continuation",
      "",
      "2. Next",
    ].join("\n");
    expect(normalizeMarkdown(input)).toBe(input);
  });
});

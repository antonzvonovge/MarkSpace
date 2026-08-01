import { describe, expect, it } from "vitest";
import {
  editorMarkdownToHashtags,
  extractInlineTags,
  hashtagsToEditorMarkdown,
  isValidTagName,
  normalizeInlineTagName,
  tagToEditorHtml,
} from "./hashtagMarkdown";

describe("hashtagMarkdown", () => {
  it("validates tag names", () => {
    expect(isValidTagName("multi-agent")).toBe(true);
    expect(isValidTagName("project/markspace")).toBe(true);
    expect(isValidTagName("работа")).toBe(true);
    expect(isValidTagName("tag_1")).toBe(true);
    expect(isValidTagName("")).toBe(false);
    expect(isValidTagName("-bad")).toBe(false);
  });

  it("normalizes leading hash", () => {
    expect(normalizeInlineTagName("#Work")).toBe("Work");
    expect(normalizeInlineTagName("  #inbox  ")).toBe("inbox");
    expect(normalizeInlineTagName("#")).toBeNull();
  });

  it("projects hashtags to editor HTML and back", () => {
    const src = "See #multi-agent and #inbox.";
    const projected = hashtagsToEditorMarkdown(src);
    expect(projected).toContain(tagToEditorHtml("multi-agent"));
    expect(projected).toContain(tagToEditorHtml("inbox"));
    expect(editorMarkdownToHashtags(projected)).toBe(src);
  });

  it("does not treat ATX headings as tags", () => {
    const src = "# Heading\n\n## H2\n\n#real-tag";
    const projected = hashtagsToEditorMarkdown(src);
    expect(projected).toContain("# Heading");
    expect(projected).toContain("## H2");
    expect(projected).toContain(tagToEditorHtml("real-tag"));
    expect(extractInlineTags(src)).toEqual(["real-tag"]);
  });

  it("skips fenced and inline code", () => {
    const src = [
      "Outside #keep",
      "",
      "```ts",
      "const x = '#nope';",
      "```",
      "",
      "Inline `#also-no` and #yes",
    ].join("\n");
    expect(extractInlineTags(src).sort()).toEqual(["keep", "yes"].sort());
    const projected = hashtagsToEditorMarkdown(src);
    expect(projected).toContain("const x = '#nope';");
    expect(projected).toContain("`#also-no`");
    expect(projected).toContain(tagToEditorHtml("keep"));
    expect(projected).toContain(tagToEditorHtml("yes"));
  });

  it("skips URL fragments and markdown links", () => {
    const src =
      "Link [x](https://ex.com/a#frag) and <https://ex.com/b#z> then #ok";
    expect(extractInlineTags(src)).toEqual(["ok"]);
  });

  it("does not match mid-word hashes", () => {
    expect(extractInlineTags("word#not and #yes")).toEqual(["yes"]);
  });

  it("supports nested path tags and unicode", () => {
    expect(extractInlineTags("#project/markspace and #работа")).toEqual([
      "project/markspace",
      "работа",
    ]);
  });

  it("leaves trailing punctuation outside the tag", () => {
    const src = "Done #work.";
    const projected = hashtagsToEditorMarkdown(src);
    expect(projected).toBe(`Done ${tagToEditorHtml("work")}.`);
    expect(editorMarkdownToHashtags(projected)).toBe(src);
  });

  it("round-trips wiki links beside tags", () => {
    // After wikiToMarkdown, links are [text](wiki:…); hashtags must not touch them.
    const src = "See [Note](wiki:Note) and #tag";
    const projected = hashtagsToEditorMarkdown(src);
    expect(projected).toContain("[Note](wiki:Note)");
    expect(projected).toContain(tagToEditorHtml("tag"));
    expect(editorMarkdownToHashtags(projected)).toBe(src);
  });
});

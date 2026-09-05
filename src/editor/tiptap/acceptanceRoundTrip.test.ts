import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { editorMarkdownToHashtags } from "../../lib/hashtagMarkdown";
import {
  editorMarkdownToMath,
  mathToEditorMarkdown,
} from "../../lib/mathMarkdown";
import { markdownToWiki, wikiToMarkdown } from "../../lib/wikiMarkdown";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "./markdownBridge";
import { createNoteTiptapExtensions } from "./noteExtensions";

function roundTripBody(markdown: string): string {
  const projected = mathToEditorMarkdown(
    editorMarkdownToHashtags(wikiToMarkdown(markdown)),
  );
  const html = markdownToEditorHtml(projected);
  const editor = new Editor({
    extensions: createNoteTiptapExtensions({ path: "Notes/sample.md" }),
    content: html,
  });
  try {
    const out = editorHtmlToMarkdown(editor.getHTML());
    return markdownToWiki(editorMarkdownToMath(editorMarkdownToHashtags(out)));
  } finally {
    editor.destroy();
  }
}

describe("TipTap Live acceptance smoke", () => {
  it("round-trips headings and paragraphs", () => {
    const src = "# Title\n\nHello **world**.\n";
    const out = roundTripBody(src);
    expect(out).toContain("# Title");
    expect(out).toMatch(/Hello \*\*world\*\*\.?/);
  });

  it("round-trips mermaid fence as atom", () => {
    const src = "```mermaid\nflowchart TD\n  A --> B\n```\n";
    const out = roundTripBody(src);
    expect(out).toMatch(/```mermaid/);
    expect(out).toContain("A --> B");
  });

  it("round-trips task list", () => {
    const src = "- [ ] open\n- [x] done\n";
    const out = roundTripBody(src);
    expect(out).toMatch(/\[ \]/);
    expect(out).toMatch(/\[x\]/i);
  });

  it("preserves wiki link projection end-to-end", () => {
    const src = "See [[Other Note]] today.\n";
    const out = roundTripBody(src);
    expect(out).toContain("[[Other Note]]");
  });
});

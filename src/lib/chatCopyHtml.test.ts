import { describe, expect, it } from "vitest";
import { chatMarkdownToPasteHtml } from "./chatCopyHtml";

describe("chatMarkdownToPasteHtml", () => {
  it("turns headings, emphasis, and lists into HTML", () => {
    const html = chatMarkdownToPasteHtml(
      "## Title\n\nHello **world** and `code`.\n\n- one\n- two\n",
    );
    expect(html).toMatch(/<h2\b/i);
    expect(html).toMatch(/<(strong|b)>world<\/(strong|b)>/i);
    expect(html).toMatch(/<code>code<\/code>/i);
    expect(html).toMatch(/<ul\b/i);
    expect(html).toContain("one");
  });

  it("does not leave markdown markers in the HTML", () => {
    const html = chatMarkdownToPasteHtml("**bold**");
    expect(html).not.toContain("**");
  });
});

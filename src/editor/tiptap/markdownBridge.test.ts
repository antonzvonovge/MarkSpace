import { describe, expect, it } from "vitest";
import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
} from "./markdownBridge";

describe("markdownBridge", () => {
  it("converts paragraph and heading", () => {
    const html = markdownToEditorHtml("# Title\n\nHello world.");
    expect(html).toContain("<h1>");
    expect(html).toContain("Title");
    expect(html).toContain("<p>");
    expect(html).toContain("Hello world.");

    const md = editorHtmlToMarkdown(html);
    expect(md).toMatch(/^# Title/m);
    expect(md).toContain("Hello world.");
  });

  it("preserves fenced mermaid language on code blocks", () => {
    const source = ["```mermaid", "graph TD", "A-->B", "```"].join("\n");
    const html = markdownToEditorHtml(source);

    expect(html).toMatch(
      /<pre><code class="language-mermaid" data-language="mermaid">/,
    );
    expect(html).toContain("graph TD");
    expect(html).toContain("A--&gt;B");

    const md = editorHtmlToMarkdown(html);
    expect(md).toMatch(/```mermaid\ngraph TD\nA-->B\n```/);
  });

  it("round-trips an unordered list", () => {
    const source = "- alpha\n- beta";
    const html = markdownToEditorHtml(source);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("alpha");
    expect(html).toContain("beta");

    const md = editorHtmlToMarkdown(html);
    expect(md).toMatch(/[-*]\s+alpha/);
    expect(md).toMatch(/[-*]\s+beta/);
  });

  it("round-trips a task list", () => {
    const source = "- [ ] todo\n- [x] done";
    const html = markdownToEditorHtml(source);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="false"');
    expect(html).toContain('data-checked="true"');

    const md = editorHtmlToMarkdown(html);
    expect(md).toMatch(/\[ \].*todo/);
    expect(md).toMatch(/\[[xX]\].*done/);
  });
});

import { describe, expect, it } from "vitest";
import {
  highlightCodeToHtml,
  resolveHighlightLanguage,
} from "./codeHighlight";

describe("codeHighlight", () => {
  it("resolves common language aliases", () => {
    expect(resolveHighlightLanguage("ts")).toBe("typescript");
    expect(resolveHighlightLanguage("python")).toBe("python");
    expect(resolveHighlightLanguage("py")).toBe("python");
    expect(resolveHighlightLanguage("text")).toBeNull();
    expect(resolveHighlightLanguage("")).toBeNull();
  });

  it("highlights typescript with a light shiki theme", async () => {
    const html = await highlightCodeToHtml("const x: number = 1;", "ts");
    expect(html).toContain("shiki");
    expect(html).toContain("github-light");
    expect(html).toContain("const");
  });

  it("falls back to plain pre/code for unknown languages", async () => {
    const html = await highlightCodeToHtml("hello", "not-a-real-lang");
    expect(html).toBe('<pre><code class="language-not-a-real-lang">hello</code></pre>');
  });
});

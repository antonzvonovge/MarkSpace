import { describe, expect, it } from "vitest";
import {
  blockMathToEditorHtml,
  editorMarkdownToMath,
  inlineMathToEditorHtml,
  mathToEditorMarkdown,
  normalizeDisplayMath,
} from "./mathMarkdown";

describe("mathMarkdown", () => {
  it("projects inline and display math to editor HTML and back", () => {
    const src = "More $Cl^-$ enters.\n\n$$E = mc^2$$";
    const projected = mathToEditorMarkdown(src);
    expect(projected).toContain(inlineMathToEditorHtml("Cl^-"));
    expect(projected).toContain(blockMathToEditorHtml("E = mc^2"));
    expect(editorMarkdownToMath(projected)).toContain("$Cl^-$");
    expect(editorMarkdownToMath(projected)).toContain("$$E = mc^2$$");
  });

  it("restores KaTeX-filled HTML using data-latex only", () => {
    const html =
      'ion <span class="bn-latex" data-latex="Cl^-"><span class="katex"><span>x</span></span></span> in';
    expect(editorMarkdownToMath(html)).toBe("ion $Cl^-$ in");

    const block =
      '<div class="bn-equation" data-latex="a^2+b^2"><span class="katex">x</span></div>';
    expect(editorMarkdownToMath(block)).toBe("$$a^2+b^2$$");
  });

  it("restores math fences to display math", () => {
    expect(editorMarkdownToMath("```math\nE = mc^2\n```")).toBe("$$E = mc^2$$");
    expect(editorMarkdownToMath("```latex\na+b\n```")).toBe("$$a+b$$");
  });

  it("skips fenced and inline code", () => {
    const src = ["Outside $a$", "", "```md", "$nope$", "```", "", "`$also$`"].join(
      "\n",
    );
    const projected = mathToEditorMarkdown(src);
    expect(projected).toContain(inlineMathToEditorHtml("a"));
    expect(projected).toContain("$nope$");
    expect(projected).toContain("`$also$`");
  });

  it("does not treat lone currency dollars as math", () => {
    expect(mathToEditorMarkdown("Costs $5 today")).toBe("Costs $5 today");
    expect(mathToEditorMarkdown("Costs $5$ today")).toContain(
      inlineMathToEditorHtml("5"),
    );
  });

  it("ignores escaped dollars", () => {
    expect(mathToEditorMarkdown("use \\$x\\$ or $y$")).toBe(
      `use \\$x\\$ or ${inlineMathToEditorHtml("y")}`,
    );
  });

  it("requires tight inline delimiters", () => {
    expect(mathToEditorMarkdown("bad $ x $ ok")).toBe("bad $ x $ ok");
  });

  it("projects math that contains < comparisons", () => {
    expect(mathToEditorMarkdown("threshold $<5$ here")).toBe(
      `threshold ${inlineMathToEditorHtml("<5")} here`,
    );
    expect(mathToEditorMarkdown("cmp $a<b$ end")).toBe(
      `cmp ${inlineMathToEditorHtml("a<b")} end`,
    );
    expect(mathToEditorMarkdown("range $x < 5$ ok")).toBe(
      `range ${inlineMathToEditorHtml("x < 5")} ok`,
    );
    expect(mathToEditorMarkdown("$$\na < b\n$$")).toContain(
      blockMathToEditorHtml("a < b"),
    );
    // Still protects real HTML tags around math.
    const mixed = 'before <span class="x">y</span> and $<5$ after';
    const projected = mathToEditorMarkdown(mixed);
    expect(projected).toContain('<span class="x">y</span>');
    expect(projected).toContain(inlineMathToEditorHtml("<5"));
    expect(editorMarkdownToMath(projected)).toBe(mixed);
  });

  it("projects indented display math inside list items", () => {
    const src =
      "* Стратегия:\n  $$t_{sleep} = 2^{\\text{attempt}} \\times \\text{base\\_delay}$$\n  Это текст.";
    const projected = mathToEditorMarkdown(src);
    expect(projected).toContain(
      blockMathToEditorHtml(
        "t_{sleep} = 2^{\\text{attempt}} \\times \\text{base\\_delay}",
      ),
    );
    expect(projected).not.toMatch(/^[ \t]+```math/m);
    expect(projected).not.toMatch(/^[ \t]+<div data-content-type="equation"/m);
  });

  it("normalizes one-line $$…$$ to display math for remark-math", () => {
    const oneLine =
      "$$t_{sleep} = 2^{\\text{attempt}} \\times \\text{base\\_delay}$$";
    expect(normalizeDisplayMath(oneLine)).toBe(
      "$$\nt_{sleep} = 2^{\\text{attempt}} \\times \\text{base\\_delay}\n$$",
    );
    expect(normalizeDisplayMath("$$\nE = mc^2\n$$")).toBe("$$\nE = mc^2\n$$");
    expect(normalizeDisplayMath("keep $inline$")).toBe("keep $inline$");
    expect(normalizeDisplayMath("```\n$$not$$\n```")).toBe("```\n$$not$$\n```");
  });
});

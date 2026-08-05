import { describe, expect, it } from "vitest";
import {
  editorMarkdownToMath,
  inlineMathToEditorHtml,
  mathToEditorMarkdown,
} from "./mathMarkdown";

describe("mathMarkdown", () => {
  it("projects inline and display math to editor HTML and back", () => {
    const src = "More $Cl^-$ enters.\n\n$$E = mc^2$$";
    const projected = mathToEditorMarkdown(src);
    expect(projected).toContain(inlineMathToEditorHtml("Cl^-"));
    expect(projected).toContain("```math\nE = mc^2\n```");
    expect(editorMarkdownToMath(projected)).toBe(
      "More $Cl^-$ enters.\n\n$$E = mc^2$$",
    );
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
});

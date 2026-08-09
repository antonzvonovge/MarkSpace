import { BlockNoteEditor } from "@blocknote/core";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import katex from "katex";
import {
  editorMarkdownToMath,
  mathToEditorMarkdown,
} from "./mathMarkdown";
import { noteEditorSchema } from "../editor/schema";

const SLIDE13 =
  "/home/atott/Documents/my-markspace/Клуб Синдикат ИИ/Встречи клуба/#3 Agentic Loops - состояние, графы, уровни автономности/План презентации - Agentic Loops/Слайд 13 - Optimistic Concurrency Control (Оптимистичная блокировка).md";

describe("slide 13 math in list", () => {
  let editor: BlockNoteEditor<
    typeof noteEditorSchema.blockSchema,
    typeof noteEditorSchema.inlineContentSchema,
    typeof noteEditorSchema.styleSchema
  >;

  afterEach(() => {
    editor?._tiptapEditor?.destroy();
  });

  it("loads the backoff formula as an equation block", () => {
    const source = readFileSync(SLIDE13, "utf8");
    const body = source.replace(/^---[\s\S]*?---\n/, "");
    const projected = mathToEditorMarkdown(body);

    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    const blocks = editor.tryParseMarkdownToBlocks(projected);
    editor.replaceBlocks(editor.document, blocks);

    const equations = editor.document.filter((b) => b.type === "equation");
    expect(equations.length).toBeGreaterThanOrEqual(1);
    const latex =
      equations[0] && "props" in equations[0]
        ? String(equations[0].props.latex)
        : "";
    expect(latex).toContain("t_{sleep}");
    expect(latex).toContain("base\\_delay");
    expect(() =>
      katex.renderToString(latex, { displayMode: true, throwOnError: true }),
    ).not.toThrow();

    const md = editorMarkdownToMath(editor.blocksToMarkdownLossy());
    expect(md).toContain("t_{sleep}");
    expect(md).toMatch(/base\\_delay|base_delay/);
  });
});

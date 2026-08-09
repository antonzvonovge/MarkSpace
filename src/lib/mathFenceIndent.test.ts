import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorSchema } from "../editor/schema";
import { mathToEditorMarkdown } from "./mathMarkdown";

describe("display math inside lists", () => {
  let editor: BlockNoteEditor<
    typeof noteEditorSchema.blockSchema,
    typeof noteEditorSchema.inlineContentSchema,
    typeof noteEditorSchema.styleSchema
  >;
  afterEach(() => {
    editor?._tiptapEditor?.destroy();
  });

  function load(md: string) {
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    const blocks = editor.tryParseMarkdownToBlocks(md);
    editor.replaceBlocks(editor.document, blocks);
    return editor.document.filter((b) => b.type === "equation");
  }

  it("projects indented $$ inside a list to a real equation block", () => {
    const md = mathToEditorMarkdown(
      "* Стратегия:\n  $$t_{sleep} = 2^{\\text{attempt}}$$\n  Это текст.",
    );
    const equations = load(md);
    expect(equations).toHaveLength(1);
    expect(
      equations[0] && "props" in equations[0] ? equations[0].props.latex : "",
    ).toContain("t_{sleep}");
  });
});

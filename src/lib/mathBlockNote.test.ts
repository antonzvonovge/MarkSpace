import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  editorMarkdownToMath,
  mathToEditorMarkdown,
} from "./mathMarkdown";
import { noteEditorSchema } from "../editor/schema";

describe("math BlockNote round-trip", () => {
  let editor: BlockNoteEditor<
    typeof noteEditorSchema.blockSchema,
    typeof noteEditorSchema.inlineContentSchema,
    typeof noteEditorSchema.styleSchema
  >;

  afterEach(() => {
    editor?._tiptapEditor?.destroy();
  });

  it("parses $ and $$ into latex / equation and serializes back", () => {
    editor = BlockNoteEditor.create({ schema: noteEditorSchema });
    const source = "More $Cl^-$ enters the neuron.\n\n$$E = mc^2$$";
    const projected = mathToEditorMarkdown(source);
    const blocks = editor.tryParseMarkdownToBlocks(projected);
    editor.replaceBlocks(editor.document, blocks);

    const types = editor.document.map((b) => b.type);
    expect(types).toContain("equation");

    const para = editor.document.find((b) => b.type === "paragraph");
    expect(para).toBeTruthy();
    const inline = JSON.stringify(para?.content ?? []);
    expect(inline).toContain('"type":"latex"');
    expect(inline).toContain("Cl^-");

    const eq = editor.document.find((b) => b.type === "equation");
    expect(eq && "props" in eq ? eq.props.latex : "").toBe("E = mc^2");

    const md = editorMarkdownToMath(editor.blocksToMarkdownLossy());
    expect(md).toContain("$Cl^-$");
    expect(md).toContain("$$E = mc^2$$");
  });
});

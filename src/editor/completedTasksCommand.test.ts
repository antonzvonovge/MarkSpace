import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { nestedHtmlToMarkdown } from "../lib/nestedListMarkdown";
import { normalizeMarkdown } from "../lib/normalizeMarkdown";
import { noteEditorSchema, type NoteEditor } from "./schema";
import { deleteCompletedTasksFromLiveEditor } from "./completedTasksCommand";

let editor: NoteEditor | null = null;

function withMarkdown(markdown: string): NoteEditor {
  const next = BlockNoteEditor.create({ schema: noteEditorSchema });
  const blocks = next.tryParseMarkdownToBlocks(markdown);
  next.replaceBlocks(next.document, blocks);
  editor = next;
  return next;
}

function savedMarkdown(ed: NoteEditor): string {
  return normalizeMarkdown(
    nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document)),
  );
}

afterEach(() => {
  editor?._tiptapEditor.destroy();
  editor = null;
});

describe("deleteCompletedTasksFromLiveEditor", () => {
  it("removes completed checkbox blocks from the whole document", () => {
    const ed = withMarkdown(
      ["* [x] done", "* [ ] open", "* [x] also done"].join("\n"),
    );
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(2);
    expect(savedMarkdown(ed).trim()).toBe("* [ ] open");
  });

  it("removes nested children when the parent checkbox is completed", () => {
    const ed = withMarkdown(
      ["* [x] done parent", "  * nested", "* [ ] sibling"].join("\n"),
    );
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    expect(savedMarkdown(ed)).toContain("sibling");
    expect(savedMarkdown(ed)).not.toContain("done parent");
    expect(savedMarkdown(ed)).not.toContain("nested");
  });

  it("only removes completed items inside the current selection", () => {
    const ed = withMarkdown(
      ["* [x] first", "* [ ] mid", "* [x] last"].join("\n"),
    );
    const [a, b] = ed.document;
    expect(a && b).toBeTruthy();
    ed.setSelection(a!.id, b!.id);
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    const md = savedMarkdown(ed);
    expect(md).not.toContain("first");
    expect(md).toContain("mid");
    expect(md).toContain("last");
  });

  it("leaves an empty paragraph when every block is a completed task", () => {
    const ed = withMarkdown("* [x] only");
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    expect(ed.document).toHaveLength(1);
    expect(ed.document[0]?.type).toBe("paragraph");
  });
});

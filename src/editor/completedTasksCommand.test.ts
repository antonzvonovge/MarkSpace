import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeMarkdown } from "../lib/normalizeMarkdown";
import { deleteCompletedTasksFromLiveEditor } from "./completedTasksCommand";
import { editorHtmlToMarkdown, markdownToEditorHtml } from "./tiptap/markdownBridge";
import { createNoteTiptapExtensions } from "./tiptap/noteExtensions";

let editor: Editor | null = null;

function withMarkdown(markdown: string): Editor {
  const next = new Editor({
    extensions: createNoteTiptapExtensions({ path: "test.md" }),
    content: markdownToEditorHtml(markdown),
  });
  editor = next;
  return next;
}

function savedMarkdown(ed: Editor): string {
  return normalizeMarkdown(editorHtmlToMarkdown(ed.getHTML()));
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("deleteCompletedTasksFromLiveEditor", () => {
  it("removes completed checkbox blocks from the whole document", () => {
    const ed = withMarkdown(
      ["- [x] done", "- [ ] open", "- [x] also done"].join("\n"),
    );
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(2);
    expect(savedMarkdown(ed).trim()).toBe("- [ ] open");
  });

  it("removes nested children when the parent checkbox is completed", () => {
    const ed = withMarkdown(
      ["- [x] done parent", "  - nested", "- [ ] sibling"].join("\n"),
    );
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    const md = savedMarkdown(ed);
    expect(md).toContain("sibling");
    expect(md).not.toContain("done parent");
    expect(md).not.toContain("nested");
  });

  it("only removes completed items inside the current selection", () => {
    const ed = withMarkdown(
      ["- [x] first", "- [ ] mid", "- [x] last"].join("\n"),
    );
    // Select the first task item only (node selection).
    let firstPos: number | null = null;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && firstPos == null) {
        firstPos = pos;
        return false;
      }
    });
    expect(firstPos).not.toBeNull();
    ed.commands.setNodeSelection(firstPos!);
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    const md = savedMarkdown(ed);
    expect(md).not.toContain("first");
    expect(md).toContain("mid");
    expect(md).toContain("last");
  });

  it("leaves an empty paragraph when every block is a completed task", () => {
    const ed = withMarkdown("- [x] only");
    expect(deleteCompletedTasksFromLiveEditor(ed)).toBe(1);
    const text = ed.state.doc.textContent.trim();
    expect(text).toBe("");
  });
});

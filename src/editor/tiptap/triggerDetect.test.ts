import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { findSlashTrigger, findTagTrigger } from "./triggerDetect";

function editorWith(text: string, caret?: number) {
  const editor = new Editor({
    extensions: [StarterKit],
    content: `<p>${text}</p>`,
  });
  const pos = 1 + (caret ?? text.length);
  editor.commands.setTextSelection(pos);
  return editor;
}

describe("findSlashTrigger", () => {
  it("matches / at start of block", () => {
    const ed = editorWith("/he");
    const m = findSlashTrigger(ed.state);
    expect(m?.query).toBe("he");
    ed.destroy();
  });

  it("matches / after space", () => {
    const ed = editorWith("hi /ta");
    const m = findSlashTrigger(ed.state);
    expect(m?.query).toBe("ta");
    ed.destroy();
  });

  it("does not match mid-word slash", () => {
    const ed = editorWith("path/to");
    expect(findSlashTrigger(ed.state)).toBeNull();
    ed.destroy();
  });
});

describe("findTagTrigger", () => {
  it("matches #tag at start", () => {
    const ed = editorWith("#inbox");
    expect(findTagTrigger(ed.state)?.query).toBe("inbox");
    ed.destroy();
  });

  it("rejects # after a letter", () => {
    const ed = editorWith("a#x");
    expect(findTagTrigger(ed.state)).toBeNull();
    ed.destroy();
  });
});

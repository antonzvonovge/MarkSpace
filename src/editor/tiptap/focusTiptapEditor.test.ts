import { describe, expect, it } from "vitest";
import { isEmptyTiptapEditorClick } from "./focusTiptapEditor";

function el(html: string): Element {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root.firstElementChild!;
}

describe("isEmptyTiptapEditorClick", () => {
  it("treats ProseMirror content clicks as not empty", () => {
    const p = el(
      `<div class="bn-editor ProseMirror"><p>Hello</p></div>`,
    ).querySelector("p")!;
    expect(isEmptyTiptapEditorClick(p)).toBe(false);
  });

  it("treats ProseMirror root / padding as empty", () => {
    const pm = el(`<div class="editor-canvas"><div class="bn-editor ProseMirror"></div></div>`).querySelector(
      ".ProseMirror",
    )!;
    expect(isEmptyTiptapEditorClick(pm)).toBe(true);
  });

  it("treats canvas gutter as empty", () => {
    const canvas = el(`<div class="editor-canvas"></div>`);
    expect(isEmptyTiptapEditorClick(canvas)).toBe(true);
  });
});

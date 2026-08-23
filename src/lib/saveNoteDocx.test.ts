import { describe, expect, it } from "vitest";
import { siblingDocxRel, wrapNoteHtmlForDocx } from "./saveNoteDocx";

describe("saveNoteDocx", () => {
  it("puts the docx next to the markdown note", () => {
    expect(siblingDocxRel("English/a.md")).toBe("English/a.docx");
    expect(siblingDocxRel("note.md")).toBe("note.docx");
    expect(siblingDocxRel("/English/IELTS/foo.md")).toBe("English/IELTS/foo.docx");
  });

  it("wraps fragment HTML as a document", () => {
    const html = wrapNoteHtmlForDocx("<h1>Hi</h1><p><strong>bold</strong></p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Hi</h1>");
  });
});

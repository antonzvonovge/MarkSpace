import { describe, expect, it } from "vitest";
import { formatToolbarPath } from "./documentPath";

describe("formatToolbarPath", () => {
  it("returns short paths unchanged", () => {
    expect(formatToolbarPath("Notes/todo.md")).toBe("Notes/todo.md");
  });

  it("keeps the filename when collapsing middle dirs", () => {
    const path =
      "Projects/alpha/beta/gamma/delta/epsilon/zeta/very-important-note.md";
    const out = formatToolbarPath(path, 48);
    expect(out.endsWith("very-important-note.md")).toBe(true);
    expect(out.includes("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(48);
  });

  it("shortens long intermediate segments", () => {
    const path =
      "Projects/super-long-folder-name-here/notes/readme.md";
    const out = formatToolbarPath(path, 56);
    expect(out.endsWith("readme.md")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(56);
  });
});

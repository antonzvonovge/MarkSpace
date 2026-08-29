import { describe, expect, it } from "vitest";
import { formatToolbarPath, toolbarPathParts } from "./documentPath";

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

describe("toolbarPathParts", () => {
  it("maps folder segments to full vault paths", () => {
    expect(toolbarPathParts("Медиатека/2026-Холод.md")).toEqual([
      { kind: "folder", path: "Медиатека", label: "Медиатека" },
      { kind: "file", label: "2026-Холод.md" },
    ]);
  });

  it("keeps full paths when collapsing middle dirs", () => {
    const path = "Projects/alpha/beta/gamma/delta/note.md";
    const parts = toolbarPathParts(path, 36);
    const folders = parts.filter((p) => p.kind === "folder");
    expect(folders.length).toBeGreaterThanOrEqual(1);
    expect(folders.every((p) => p.kind === "folder" && path.startsWith(p.path))).toBe(
      true,
    );
    expect(parts.some((p) => p.kind === "ellipsis")).toBe(true);
  });
});

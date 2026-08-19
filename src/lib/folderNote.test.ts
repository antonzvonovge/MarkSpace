import { describe, expect, it } from "vitest";
import {
  folderPathFromFolderNote,
  isFolderNotePath,
  treeRevealTarget,
} from "./vaultApi";

describe("treeRevealTarget", () => {
  it("maps a hidden folder note to its parent folder", () => {
    expect(treeRevealTarget("Projects/.folder.md")).toEqual({
      treePath: "Projects",
      isDir: true,
    });
    expect(treeRevealTarget("Projects/ideas/.folder.md")).toEqual({
      treePath: "Projects/ideas",
      isDir: true,
    });
    expect(treeRevealTarget(".folder.md")).toEqual({
      treePath: "",
      isDir: true,
    });
  });

  it("leaves ordinary files as file rows", () => {
    expect(treeRevealTarget("Projects/Note.md")).toEqual({
      treePath: "Projects/Note.md",
      isDir: false,
    });
  });

  it("returns null for an empty path", () => {
    expect(treeRevealTarget("")).toBeNull();
  });
});

describe("folder note path helpers", () => {
  it("detects .folder.md at any depth", () => {
    expect(isFolderNotePath("Projects/.folder.md")).toBe(true);
    expect(isFolderNotePath("Projects/Note.md")).toBe(false);
    expect(folderPathFromFolderNote("A/B/.folder.md")).toBe("A/B");
    expect(folderPathFromFolderNote("Note.md")).toBeNull();
  });
});

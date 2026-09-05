import { describe, expect, it } from "vitest";
import type { TreeNode } from "./vaultApi";
import {
  notePathToFolderPath,
  optimisticMoveInTree,
  optimisticNestUnderNoteInTree,
  predictMovePath,
} from "./optimisticVaultTree";

function node(
  path: string,
  name: string,
  isDir: boolean,
  children: TreeNode[] = [],
): TreeNode {
  return { path, name, isDir, children };
}

const sample: TreeNode = node("", "Vault", true, [
  node("Skills", "Skills", true, []),
  node("Proj", "Proj", true, [
    node("Proj/a.md", "a.md", false),
    node("Proj/b.md", "b.md", false),
    node("Proj/sub", "sub", true, [node("Proj/sub/c.md", "c.md", false)]),
  ]),
  node("root.md", "root.md", false),
]);

describe("predictMovePath", () => {
  it("keeps path on same-parent reorder", () => {
    expect(predictMovePath("Proj/a.md", "Proj")).toBe("Proj/a.md");
  });

  it("joins parent for cross-folder move", () => {
    expect(predictMovePath("root.md", "Proj")).toBe("Proj/root.md");
  });
});

describe("optimisticMoveInTree", () => {
  it("reorders siblings without changing paths", () => {
    const result = optimisticMoveInTree(sample, "Proj/b.md", "Proj", 0);
    expect(result?.nextPath).toBe("Proj/b.md");
    const proj = result!.tree.children!.find((c) => c.path === "Proj")!;
    expect(proj.children!.map((c) => c.path)).toEqual([
      "Proj/b.md",
      "Proj/a.md",
      "Proj/sub",
    ]);
  });

  it("moves into another folder and remaps nested paths", () => {
    const result = optimisticMoveInTree(sample, "Proj/sub", "", 1);
    expect(result?.nextPath).toBe("sub");
    expect(result!.tree.children!.map((c) => c.path)).toEqual([
      "Skills",
      "sub",
      "Proj",
      "root.md",
    ]);
    const sub = result!.tree.children!.find((c) => c.path === "sub")!;
    expect(sub.children!.map((c) => c.path)).toEqual(["sub/c.md"]);
  });

  it("returns null when target path exists", () => {
    const tree = node("", "Vault", true, [
      node("a.md", "a.md", false),
      node("Proj", "Proj", true, [node("Proj/a.md", "a.md", false)]),
    ]);
    expect(optimisticMoveInTree(tree, "a.md", "Proj", 0)).toBeNull();
  });
});

describe("optimisticNestUnderNoteInTree", () => {
  it("promotes note to folder and nests the dragged file", () => {
    const result = optimisticNestUnderNoteInTree(
      sample,
      "root.md",
      "Proj/a.md",
      0,
    );
    expect(result).not.toBeNull();
    expect(result!.folder).toBe("Proj/a");
    expect(result!.folderNote).toBe("Proj/a/.folder.md");
    expect(result!.moved).toBe("Proj/a/root.md");
    const proj = result!.tree.children!.find((c) => c.path === "Proj")!;
    expect(proj.children!.map((c) => c.path)).toEqual([
      "Proj/a",
      "Proj/b.md",
      "Proj/sub",
    ]);
    const folder = proj.children!.find((c) => c.path === "Proj/a")!;
    expect(folder.isDir).toBe(true);
    expect(folder.children!.map((c) => c.path)).toEqual(["Proj/a/root.md"]);
  });

  it("parses note stem folder path", () => {
    expect(notePathToFolderPath("Proj/Note.md")).toBe("Proj/Note");
    expect(notePathToFolderPath("x.drawio")).toBeNull();
  });
});

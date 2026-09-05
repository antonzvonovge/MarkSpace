import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../lib/vaultApi";
import {
  canDropVaultPath,
  flattenAllWorkspace,
  flattenVisibleWorkspace,
  VAULT_PATH,
} from "./vaultTreeFlatten";
import { resolveVaultDrop } from "./vaultTreeDnD";

function node(
  path: string,
  name: string,
  isDir: boolean,
  children: TreeNode[] = [],
): TreeNode {
  return { path, name, isDir, children };
}

const sample: TreeNode = node("", "Vault", true, [
  node("Incoming", "Incoming", true, [node("Incoming/a.md", "a.md", false)]),
  node("Tasks", "Tasks", true, []),
  node("Skills", "Skills", true, [node("Skills/x.md", "x.md", false)]),
  node("Proj", "Proj", true, [
    node("Proj/note.md", "note.md", false),
    node("Proj/sub", "sub", true, [node("Proj/sub/deep.md", "deep.md", false)]),
  ]),
  node("root.md", "root.md", false),
]);

describe("flattenVisibleWorkspace", () => {
  it("omits Incoming and Tasks from workspace flatten", () => {
    const rows = flattenAllWorkspace(sample);
    expect(rows.some((r) => r.path === "Incoming")).toBe(false);
    expect(rows.some((r) => r.path === "Tasks")).toBe(false);
    expect(rows.some((r) => r.path === "Skills")).toBe(true);
    expect(rows.some((r) => r.path === "Proj")).toBe(true);
  });

  it("vault root is always visible; children only when expanded", () => {
    const closed = flattenVisibleWorkspace(sample, []);
    expect(closed.map((r) => r.path)).toEqual([
      VAULT_PATH,
      "Skills",
      "Proj",
      "root.md",
    ]);

    const openProj = flattenVisibleWorkspace(sample, ["Proj"]);
    expect(openProj.map((r) => r.path)).toEqual([
      VAULT_PATH,
      "Skills",
      "Proj",
      "Proj/note.md",
      "Proj/sub",
      "root.md",
    ]);

    const deep = flattenVisibleWorkspace(sample, ["Proj", "Proj/sub"]);
    expect(deep.map((r) => r.path)).toContain("Proj/sub/deep.md");
  });

  it("marks .md notes droppable and folders droppable", () => {
    const rows = flattenAllWorkspace(sample);
    expect(rows.find((r) => r.path === "Proj")?.droppable).toBe(true);
    expect(rows.find((r) => r.path === "Proj/note.md")?.droppable).toBe(true);
    expect(rows.find((r) => r.path === VAULT_PATH)?.droppable).toBe(true);
  });
});

describe("canDropVaultPath / Skills", () => {
  it("blocks dropping Skills into nested folders", () => {
    expect(canDropVaultPath("Skills", "Proj", true)).toBe(false);
    expect(canDropVaultPath("Skills", VAULT_PATH, true)).toBe(true);
  });

  it("blocks drop into self or descendant", () => {
    expect(canDropVaultPath("Proj", "Proj", true)).toBe(false);
    expect(canDropVaultPath("Proj", "Proj/sub", true)).toBe(false);
  });
});

describe("resolveVaultDrop", () => {
  it("nests onto markdown note", () => {
    const rows = flattenVisibleWorkspace(sample, ["Proj"]);
    const drop = resolveVaultDrop(rows, "root.md", "Proj/note.md");
    expect(drop).toEqual({
      kind: "nest-note",
      from: "root.md",
      targetPath: "Proj/note.md",
      toIndex: 0,
    });
  });

  it("moves into folder", () => {
    const rows = flattenVisibleWorkspace(sample, []);
    const drop = resolveVaultDrop(rows, "root.md", "Proj");
    expect(drop?.kind).toBe("move");
    expect(drop?.targetPath).toBe("Proj");
  });
});

import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../lib/vaultApi";
import {
  canDropVaultPath,
  flattenAllWorkspace,
  flattenVisibleWorkspace,
  VAULT_PATH,
} from "./vaultTreeFlatten";
import { resolveVaultDrop, placementFromPointerRatio } from "./vaultTreeDnD";

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
  it("nests onto markdown note when placement is inside", () => {
    const rows = flattenVisibleWorkspace(sample, ["Proj"]);
    const drop = resolveVaultDrop(rows, "root.md", "Proj/note.md", "inside");
    expect(drop).toEqual({
      kind: "nest-note",
      from: "root.md",
      targetPath: "Proj/note.md",
      toIndex: 0,
    });
  });

  it("moves into folder when placement is inside", () => {
    const rows = flattenVisibleWorkspace(sample, []);
    const drop = resolveVaultDrop(rows, "root.md", "Proj", "inside");
    expect(drop?.kind).toBe("move");
    expect(drop?.targetPath).toBe("Proj");
  });

  it("reorders as sibling before target", () => {
    const rows = flattenVisibleWorkspace(sample, []);
    const drop = resolveVaultDrop(rows, "root.md", "Proj", "before");
    expect(drop).toEqual({
      kind: "move",
      from: "root.md",
      targetPath: VAULT_PATH,
      toIndex: rows.find((r) => r.path === "Proj")!.indexAmongSiblings,
    });
  });

  it("reorders as sibling after target", () => {
    const rows = flattenVisibleWorkspace(sample, []);
    const drop = resolveVaultDrop(rows, "Skills", "Proj", "after");
    expect(drop).toEqual({
      kind: "move",
      from: "Skills",
      targetPath: VAULT_PATH,
      // Skills(0) after Proj(1) → toIndex 2, then same-parent adjust → 1
      toIndex: 1,
    });
  });
});

describe("placementFromPointerRatio", () => {
  it("uses edge bands for folders and center for inside", () => {
    const rows = flattenVisibleWorkspace(sample, []);
    const proj = rows.find((r) => r.path === "Proj")!;
    expect(placementFromPointerRatio(proj, 0.1)).toBe("before");
    expect(placementFromPointerRatio(proj, 0.5)).toBe("inside");
    expect(placementFromPointerRatio(proj, 0.9)).toBe("after");
  });
});

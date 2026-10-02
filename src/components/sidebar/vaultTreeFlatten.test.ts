import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../lib/vaultApi";
import {
  canDropVaultPath,
  canMoveBetweenIncomingAndWorkspace,
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

  it("numbers siblings as on disk, including rows hidden from this list", () => {
    // `indexAmongSiblings` is sent to `move_entry` as a slot in the parent's
    // order, which still contains Incoming / Tasks.
    const rows = flattenVisibleWorkspace(sample, []);
    expect(rows.find((r) => r.path === "Skills")?.indexAmongSiblings).toBe(2);
    expect(rows.find((r) => r.path === "Proj")?.indexAmongSiblings).toBe(3);
    expect(rows.find((r) => r.path === "root.md")?.indexAmongSiblings).toBe(4);
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

describe("canMoveBetweenIncomingAndWorkspace", () => {
  it("accepts Incoming items dropped on the workspace tree", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Incoming/a.md", "Proj")).toBe(
      true,
    );
    expect(canMoveBetweenIncomingAndWorkspace("Incoming/box", VAULT_PATH)).toBe(
      true,
    );
  });

  it("accepts workspace items dropped on Incoming", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Proj/note.md", "Incoming")).toBe(
      true,
    );
    expect(canMoveBetweenIncomingAndWorkspace("Proj", "Incoming/box")).toBe(
      true,
    );
  });

  it("accepts moves deeper inside Incoming", () => {
    expect(
      canMoveBetweenIncomingAndWorkspace("Incoming/a.md", "Incoming/box"),
    ).toBe(true);
  });

  it("rejects drops on the folder the item already sits in", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Incoming/a.md", "Incoming")).toBe(
      false,
    );
    expect(canMoveBetweenIncomingAndWorkspace("Proj/note.md", "Proj")).toBe(
      false,
    );
  });

  it("rejects reserved folders as source or destination", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Incoming", "Proj")).toBe(false);
    expect(canMoveBetweenIncomingAndWorkspace("Tasks", "Incoming")).toBe(false);
    for (const dest of ["Tasks", "Routines", "Dashboards"]) {
      expect(canMoveBetweenIncomingAndWorkspace("Incoming/a.md", dest)).toBe(
        false,
      );
    }
  });

  it("keeps Skills at the vault root", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Skills", "Incoming")).toBe(
      false,
    );
  });

  it("ignores drags that touch neither Incoming side", () => {
    expect(canMoveBetweenIncomingAndWorkspace("Proj/note.md", "Journal")).toBe(
      false,
    );
    expect(canMoveBetweenIncomingAndWorkspace("", "Incoming")).toBe(false);
  });

  it("rejects dropping a folder into its own subtree", () => {
    expect(
      canMoveBetweenIncomingAndWorkspace("Incoming/box", "Incoming/box/deep"),
    ).toBe(false);
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
      // Skills(2) after Proj(3) → toIndex 4, then same-parent adjust → 3,
      // which lands right after Proj once Skills is pulled out of the order.
      toIndex: 3,
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

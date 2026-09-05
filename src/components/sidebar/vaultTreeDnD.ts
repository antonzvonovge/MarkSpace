import type { FlattenedVaultRow } from "./vaultTreeFlatten";
import { VAULT_PATH, canDropVaultPath } from "./vaultTreeFlatten";

export type VaultDropKind = "move" | "nest-note";

/** Where the pointer sits relative to the hovered row. */
export type VaultDropPlacement = "before" | "after" | "inside";

export type VaultDropIndicator = {
  path: string;
  placement: VaultDropPlacement;
};

export type VaultDropResult = {
  kind: VaultDropKind;
  from: string;
  /** Parent folder for move, or note path for nest-note. */
  targetPath: string;
  toIndex: number;
};

function isMdNestTarget(row: FlattenedVaultRow): boolean {
  return row.droppable && !row.isDir;
}

/**
 * Map pointer Y within the over-row rect to before / after / inside.
 * Folders and nestable `.md` notes use edge bands; plain files are before/after only.
 */
export function placementFromPointerRatio(
  over: FlattenedVaultRow,
  ratio: number,
): VaultDropPlacement {
  const r = Math.min(1, Math.max(0, ratio));
  if (over.path === VAULT_PATH) return "inside";
  if (over.isDir) {
    if (r < 0.25) return "before";
    if (r > 0.75) return "after";
    return "inside";
  }
  if (isMdNestTarget(over)) {
    if (r < 0.28) return "before";
    if (r > 0.72) return "after";
    return "inside";
  }
  return r < 0.5 ? "before" : "after";
}

function parentOfRow(row: FlattenedVaultRow): string {
  return row.parentPath === "__tree_root__" ? VAULT_PATH : row.parentPath;
}

function endChildIndex(rows: FlattenedVaultRow[], folderPath: string, from: string): number {
  let toIndex = 0;
  for (const r of rows) {
    if (r.parentPath !== folderPath) continue;
    if (r.path === from) continue;
    toIndex = r.indexAmongSiblings + 1;
  }
  return toIndex;
}

/**
 * Resolve drop of `from` onto visible row `over` with a placement.
 * - `inside` folder → move into that folder
 * - `inside` .md → nest under note
 * - `before` / `after` → reorder / move as sibling of `over`
 */
export function resolveVaultDrop(
  rows: FlattenedVaultRow[],
  from: string,
  overPath: string,
  placement: VaultDropPlacement,
): VaultDropResult | null {
  if (!from || from === overPath) return null;
  const over = rows.find((r) => r.path === overPath);
  if (!over) return null;

  let effective: VaultDropPlacement = placement;
  if (effective === "inside") {
    if (over.isDir) {
      if (!canDropVaultPath(from, over.path, true)) return null;
      return {
        kind: "move",
        from,
        targetPath: over.path,
        toIndex: endChildIndex(rows, over.path, from),
      };
    }
    if (isMdNestTarget(over)) {
      if (!canDropVaultPath(from, over.path, false)) return null;
      return {
        kind: "nest-note",
        from,
        targetPath: over.path,
        toIndex: 0,
      };
    }
    // Non-nestable file: treat as before.
    effective = "before";
  }

  const parent = parentOfRow(over);
  if (!canDropVaultPath(from, parent, true)) return null;

  let toIndex =
    over.indexAmongSiblings + (effective === "after" ? 1 : 0);

  // Same-parent reorder: after removing `from`, indices above it shift down.
  const fromRow = rows.find((r) => r.path === from);
  if (
    fromRow &&
    parentOfRow(fromRow) === parent &&
    fromRow.indexAmongSiblings < toIndex
  ) {
    toIndex -= 1;
  }

  return {
    kind: "move",
    from,
    targetPath: parent,
    toIndex,
  };
}

export function dropIndicatorsEqual(
  a: VaultDropIndicator | null,
  b: VaultDropIndicator | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.placement === b.placement;
}

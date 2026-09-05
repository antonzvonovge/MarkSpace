import type { FlattenedVaultRow } from "./vaultTreeFlatten";
import { VAULT_PATH, canDropVaultPath } from "./vaultTreeFlatten";

export type VaultDropKind = "move" | "nest-note";

export type VaultDropResult = {
  kind: VaultDropKind;
  from: string;
  /** Parent folder for move, or note path for nest-note. */
  targetPath: string;
  toIndex: number;
};

/**
 * Resolve drop of `from` onto visible row `over`.
 * - Folder / vault → move into that folder (index = end, or before first child if dropping "on" folder).
 * - .md note → nest under note.
 * - File (non-md) → move as sibling into its parent at that index.
 */
export function resolveVaultDrop(
  rows: FlattenedVaultRow[],
  from: string,
  overPath: string,
): VaultDropResult | null {
  if (!from || from === overPath) return null;
  const over = rows.find((r) => r.path === overPath);
  const fromRow = rows.find((r) => r.path === from);
  if (!over) return null;

  if (!canDropVaultPath(from, over.path, over.isDir)) return null;

  if (!over.isDir && over.path.toLowerCase().endsWith(".md")) {
    return {
      kind: "nest-note",
      from,
      targetPath: over.path,
      toIndex: 0,
    };
  }

  if (over.isDir) {
    // Drop into folder: place after last currently-visible direct child, or 0.
    let toIndex = 0;
    for (const r of rows) {
      if (r.parentPath === over.path) {
        if (r.path === from) continue;
        toIndex = r.indexAmongSiblings + 1;
      }
    }
    // Prefer sibling index from store model when moving within same parent.
    if (fromRow && fromRow.parentPath === over.path) {
      toIndex = over.indexAmongSiblings;
    }
    return {
      kind: "move",
      from,
      targetPath: over.path,
      toIndex,
    };
  }

  // Non-droppable file: insert as sibling before it in its parent.
  const parent = over.parentPath === "__tree_root__" ? VAULT_PATH : over.parentPath;
  if (!canDropVaultPath(from, parent, true)) return null;
  return {
    kind: "move",
    from,
    targetPath: parent,
    toIndex: over.indexAmongSiblings,
  };
}

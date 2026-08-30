import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { TreeNode } from "../../../lib/vaultApi";
import {
  nestTaskAsSubtask,
  promoteTaskToRoot,
  reorderTaskRelativeTo,
  type TaskIndexEntry,
} from "../../../lib/taskNotes";
import { parseTaskTreeId, type FlattenedTaskItem } from "./types";
import { buildTree } from "./utilities";

function pathFromTreeId(id: UniqueIdentifier | null | undefined): string | null {
  if (id == null) return null;
  const meta = parseTaskTreeId(id);
  return meta?.kind === "task" ? meta.path : null;
}

/**
 * Persist a tree drag: all rows are task files; hierarchy is `parent` frontmatter.
 */
export async function persistTaskTreeDrag(opts: {
  activeId: UniqueIdentifier;
  overId: UniqueIdentifier;
  projected: { depth: number; parentId: UniqueIdentifier | null };
  fullFlat: FlattenedTaskItem[];
  tree: TreeNode | null | undefined;
  index?: readonly TaskIndexEntry[];
}): Promise<{ expandPath?: string } | void> {
  const { activeId, overId, projected, fullFlat, tree, index } = opts;
  const activePath = pathFromTreeId(activeId);
  if (!activePath) return;

  const activeIndex = fullFlat.findIndex((i) => i.id === activeId);
  const overIndex = fullFlat.findIndex((i) => i.id === overId);
  if (activeIndex < 0 || overIndex < 0) return;

  const cloned: FlattenedTaskItem[] = structuredClone(fullFlat);
  const activeItem = cloned[activeIndex]!;
  cloned[activeIndex] = {
    ...activeItem,
    depth: projected.depth,
    parentId: projected.parentId,
  };
  const sorted = arrayMove(cloned, activeIndex, overIndex);
  const newTree = buildTree(sorted);
  const newParentPath = pathFromTreeId(projected.parentId);

  // Update parent link when depth/parent changed.
  if (newParentPath) {
    await nestTaskAsSubtask(newParentPath, activePath, index);
  } else {
    await promoteTaskToRoot(activePath);
  }

  // Reorder among siblings at the destination.
  let siblingList: FlattenedTaskItem[] | { path: string }[] = newTree;
  if (newParentPath) {
    const parentNode = newTree.find((i) => i.path === newParentPath);
    siblingList = parentNode?.children ?? [];
  }

  const idx = siblingList.findIndex((i) => i.path === activePath);
  if (idx < 0) return newParentPath ? { expandPath: newParentPath } : undefined;

  if (idx > 0) {
    const prev = siblingList[idx - 1]!;
    await reorderTaskRelativeTo(activePath, prev.path, "after", tree);
  } else if (siblingList[1]) {
    await reorderTaskRelativeTo(
      activePath,
      siblingList[1]!.path,
      "before",
      tree,
    );
  }

  return newParentPath ? { expandPath: newParentPath } : undefined;
}

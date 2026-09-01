import type { FlattenedTaskItem } from "./types";
import { MAX_TASK_TREE_DEPTH } from "./utilities";

export type TaskTreeAddSubtaskSlot = {
  parentPath: string;
  /** Indent depth for the add row (usually parent.depth + 1). */
  slotDepth: number;
};

export type TaskTreeDisplayItem = FlattenedTaskItem & {
  addSubtaskAfter?: TaskTreeAddSubtaskSlot;
};

function lastDescendantIndex(
  items: readonly FlattenedTaskItem[],
  startIdx: number,
): number {
  const startDepth = items[startIdx]!.depth;
  let last = startIdx;
  for (let i = startIdx + 1; i < items.length; i++) {
    if (items[i]!.depth <= startDepth) break;
    last = i;
  }
  return last;
}

/** Annotate flattened rows with add-subtask slots (rendered inside the host row, not as extra sortables). */
export function buildTaskTreeDisplayRows(
  items: readonly FlattenedTaskItem[],
  addComposerParentPath: string | null,
): TaskTreeDisplayItem[] {
  const addAfterIndex = new Map<number, TaskTreeAddSubtaskSlot>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.depth >= MAX_TASK_TREE_DEPTH) continue;

    const hasKids = item.children.length > 0;
    const expanded = hasKids && !item.collapsed;

    if (expanded) {
      const lastIdx = lastDescendantIndex(items, i);
      addAfterIndex.set(lastIdx, {
        parentPath: item.path,
        slotDepth: item.depth + 1,
      });
    } else if (addComposerParentPath === item.path) {
      addAfterIndex.set(i, {
        parentPath: item.path,
        slotDepth: item.depth + 1,
      });
    }
  }

  return items.map((item, i) => {
    const slot = addAfterIndex.get(i);
    if (!slot) return item;
    return { ...item, addSubtaskAfter: slot };
  });
}

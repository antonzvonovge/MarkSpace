import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  FlattenedTaskItem,
  TaskTreeItem,
  TaskTreeItems,
} from "./types";

export const iOS =
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod/.test(navigator.platform);

/** Root task = 0, subtask = 1. No deeper nesting. */
export const MAX_TASK_TREE_DEPTH = 1;

function getDragDepth(offset: number, indentationWidth: number) {
  return Math.round(offset / indentationWidth);
}

export function getProjection(
  items: FlattenedTaskItem[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
  dragOffset: number,
  indentationWidth: number,
) {
  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  const activeItem = items[activeItemIndex];
  if (!activeItem || overItemIndex < 0 || activeItemIndex < 0) {
    return {
      depth: 0,
      maxDepth: 0,
      minDepth: 0,
      parentId: null as UniqueIdentifier | null,
    };
  }
  const newItems = arrayMove(items, activeItemIndex, overItemIndex);
  const previousItem = newItems[overItemIndex - 1];
  const nextItem = newItems[overItemIndex + 1];
  const dragDepth = getDragDepth(dragOffset, indentationWidth);
  const projectedDepth = activeItem.depth + dragDepth;
  const maxDepth = getMaxDepth({ previousItem });
  const minDepth = getMinDepth({ nextItem });
  let depth = projectedDepth;

  if (projectedDepth >= maxDepth) {
    depth = maxDepth;
  } else if (projectedDepth < minDepth) {
    depth = minDepth;
  }

  return { depth, maxDepth, minDepth, parentId: getParentId() };

  function getParentId(): UniqueIdentifier | null {
    if (depth === 0 || !previousItem) {
      return null;
    }
    if (depth === previousItem.depth) {
      return previousItem.parentId;
    }
    if (depth > previousItem.depth) {
      return previousItem.id;
    }
    const newParent = newItems
      .slice(0, overItemIndex)
      .reverse()
      .find((item) => item.depth === depth)?.parentId;
    return newParent ?? null;
  }
}

function getMaxDepth({
  previousItem,
}: {
  previousItem: FlattenedTaskItem | undefined;
}) {
  if (!previousItem) return 0;
  return Math.min(previousItem.depth + 1, MAX_TASK_TREE_DEPTH);
}

function getMinDepth({ nextItem }: { nextItem: FlattenedTaskItem | undefined }) {
  if (nextItem) {
    return nextItem.depth;
  }
  return 0;
}

function flatten(
  items: TaskTreeItems,
  parentId: UniqueIdentifier | null = null,
  depth = 0,
): FlattenedTaskItem[] {
  return items.reduce<FlattenedTaskItem[]>((acc, item, index) => {
    return [
      ...acc,
      { ...item, parentId, depth, index },
      ...flatten(item.children, item.id, depth + 1),
    ];
  }, []);
}

export function flattenTree(items: TaskTreeItems): FlattenedTaskItem[] {
  return flatten(items);
}

export function buildTree(flattenedItems: FlattenedTaskItem[]): TaskTreeItems {
  const root: TaskTreeItem = {
    id: "root",
    children: [],
    kind: "task",
    path: "",
    title: "",
    status: "open",
  };
  const nodes: Record<string, TaskTreeItem> = { [String(root.id)]: root };
  const items = flattenedItems.map((item) => ({ ...item, children: [] as TaskTreeItem[] }));

  for (const item of items) {
    const { id } = item;
    const parentId = item.parentId ?? root.id;
    const parent =
      nodes[String(parentId)] ?? findItem(items, parentId) ?? root;
    nodes[String(id)] = item;
    parent.children.push(item);
  }

  return root.children;
}

export function findItem(
  items: TaskTreeItem[],
  itemId: UniqueIdentifier,
): TaskTreeItem | undefined {
  return items.find(({ id }) => id === itemId);
}

export function findItemDeep(
  items: TaskTreeItems,
  itemId: UniqueIdentifier,
): TaskTreeItem | undefined {
  for (const item of items) {
    if (item.id === itemId) return item;
    if (item.children.length) {
      const child = findItemDeep(item.children, itemId);
      if (child) return child;
    }
  }
  return undefined;
}

export function setProperty<T extends keyof TaskTreeItem>(
  items: TaskTreeItems,
  id: UniqueIdentifier,
  property: T,
  setter: (value: TaskTreeItem[T]) => TaskTreeItem[T],
): TaskTreeItems {
  for (const item of items) {
    if (item.id === id) {
      item[property] = setter(item[property]);
      continue;
    }
    if (item.children.length) {
      item.children = setProperty(item.children, id, property, setter);
    }
  }
  return [...items];
}

function countChildren(items: TaskTreeItem[], count = 0): number {
  return items.reduce((acc, { children }) => {
    if (children.length) {
      return countChildren(children, acc + 1);
    }
    return acc + 1;
  }, count);
}

export function getChildCount(items: TaskTreeItems, id: UniqueIdentifier) {
  const item = findItemDeep(items, id);
  return item ? countChildren(item.children) : 0;
}

export function removeChildrenOf(
  items: FlattenedTaskItem[],
  ids: UniqueIdentifier[],
) {
  const excludeParentIds = [...ids];
  return items.filter((item) => {
    if (item.parentId && excludeParentIds.includes(item.parentId)) {
      if (item.children.length) {
        excludeParentIds.push(item.id);
      }
      return false;
    }
    return true;
  });
}

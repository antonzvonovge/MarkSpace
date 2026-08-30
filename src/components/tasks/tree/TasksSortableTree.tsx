import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskIndexEntry } from "../../../lib/taskNotes";
import type { TreeNode } from "../../../lib/vaultApi";
import { taskEntriesToTreeItems } from "./buildTreeItems";
import { persistTaskTreeDrag } from "./persistTaskTreeDrag";
import {
  SortableTaskTreeRow,
  TaskTreeDragOverlay,
  type TaskTreeRowHandlers,
} from "./TaskTreeRow";
import { parseTaskTreeId, type TaskTreeItems } from "./types";
import {
  buildTree,
  flattenTree,
  getChildCount,
  getProjection,
  removeChildrenOf,
  setProperty,
} from "./utilities";

const measuring = {
  droppable: {
    strategy: MeasuringStrategy.Always,
  },
};

/** Drop-line mode (dnd-kit DropIndicator / AllFeatures). */
const INDICATOR = true;

const INDENTATION_WIDTH = 28;
/** Matches `--tasks-checkbox-inset` — overlay card starts at the checkbox column. */
const CHECKBOX_INSET = 54;

/** Shift the drag card so its left edge lines up with the row checkbox. */
const alignOverlayToCheckbox: Modifier = ({ transform }) => ({
  ...transform,
  x: transform.x + CHECKBOX_INSET,
});

export function TasksSortableTree({
  entries,
  expanded,
  selectedPath,
  sortable,
  vaultTree,
  handlers,
  onExpandPath,
  onPersisted,
}: {
  entries: readonly TaskIndexEntry[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  sortable: boolean;
  vaultTree: TreeNode | null | undefined;
  handlers: TaskTreeRowHandlers;
  onExpandPath?: (path: string) => void;
  /** Called after vault write; may return a Promise — kept under persisting lock until done. */
  onPersisted?: () => void | Promise<void>;
}): ReactNode {
  const [items, setItems] = useState<TaskTreeItems>(() =>
    taskEntriesToTreeItems(entries, expanded),
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const persisting = useRef(false);

  useEffect(() => {
    if (activeId != null || persisting.current) return;
    setItems(taskEntriesToTreeItems(entries, expanded));
  }, [entries, expanded, activeId]);

  const flattenedItems = useMemo(() => {
    const flattenedTree = flattenTree(items);
    const collapsedItems = flattenedTree.reduce<UniqueIdentifier[]>(
      (acc, { children, collapsed, id }) =>
        collapsed && children.length ? [...acc, id] : acc,
      [],
    );
    return removeChildrenOf(
      flattenedTree,
      activeId != null ? [activeId, ...collapsedItems] : collapsedItems,
    );
  }, [activeId, items]);

  const projected =
    activeId && overId
      ? getProjection(
          flattenedItems,
          activeId,
          overId,
          offsetLeft,
          INDENTATION_WIDTH,
        )
      : null;

  // Stock PointerSensor has no activationConstraint. When not sortable, keep a
  // dead sensor so DndContext still mounts without accidental drags.
  const sensors = useSensors(
    useSensor(
      PointerSensor,
      sortable ? undefined : { activationConstraint: { distance: 99999 } },
    ),
  );

  const sortedIds = useMemo(
    () => flattenedItems.map(({ id }) => id),
    [flattenedItems],
  );

  const activeItem = activeId
    ? flattenedItems.find(({ id }) => id === activeId)
    : null;

  const resetState = () => {
    setOverId(null);
    setActiveId(null);
    setOffsetLeft(0);
    document.body.style.setProperty("cursor", "");
  };

  const handleDragStart = ({ active }: DragStartEvent) => {
    if (!sortable) return;
    setActiveId(active.id);
    setOverId(active.id);
    document.body.style.setProperty("cursor", "grabbing");
  };

  const handleDragMove = ({ delta }: DragMoveEvent) => {
    setOffsetLeft(delta.x);
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    setOverId(over?.id ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const proj = projected;
    const fullFlat = flattenTree(items);
    // Indicator ghost is 8px — pointer can leave droppables on release.
    // Fall back to last onDragOver id (stock uses event.over only).
    const resolvedOverId = over?.id ?? overId;
    if (!sortable || !proj || resolvedOverId == null) {
      resetState();
      setItems(taskEntriesToTreeItems(entries, expanded));
      return;
    }

    const activeIndex = fullFlat.findIndex((i) => i.id === active.id);
    const overIndex = fullFlat.findIndex((i) => i.id === resolvedOverId);
    if (activeIndex < 0 || overIndex < 0) {
      resetState();
      setItems(taskEntriesToTreeItems(entries, expanded));
      return;
    }

    // Optimistic tree first, then clear drag state — one paint at the destination
    // (no dropAnimation fly-back to the old slot).
    const cloned = structuredClone(fullFlat);
    const moved = cloned[activeIndex]!;
    cloned[activeIndex] = {
      ...moved,
      depth: proj.depth,
      parentId: proj.parentId,
    };
    let newTree = buildTree(arrayMove(cloned, activeIndex, overIndex));
    if (proj.parentId != null) {
      newTree = setProperty(newTree, proj.parentId, "collapsed", () => false);
      const parentMeta = parseTaskTreeId(proj.parentId);
      if (parentMeta?.kind === "task") onExpandPath?.(parentMeta.path);
      else {
        const owner = fullFlat.find((i) => i.id === proj.parentId);
        if (owner?.path) onExpandPath?.(owner.path);
      }
    }
    persisting.current = true;
    setItems(newTree);
    resetState();

    void (async () => {
      try {
        const result = await persistTaskTreeDrag({
          activeId: active.id,
          overId: resolvedOverId,
          projected: proj,
          fullFlat,
          tree: vaultTree,
          index: entries,
        });
        if (result?.expandPath) onExpandPath?.(result.expandPath);
        await onPersisted?.();
      } catch (err) {
        console.error("Task tree drag failed", err);
        setItems(taskEntriesToTreeItems(entries, expanded));
      } finally {
        persisting.current = false;
      }
    })();
  };

  const handleDragCancel = () => {
    resetState();
    setItems(taskEntriesToTreeItems(entries, expanded));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
        <ul
          className={
            activeId
              ? "tasks-list tasks-tree-list is-dragging"
              : "tasks-list tasks-tree-list"
          }
        >
          {flattenedItems.map((item) => {
            const rowDepth =
              item.id === activeId && projected
                ? projected.depth
                : item.depth;
            return (
              <SortableTaskTreeRow
                key={String(item.id)}
                id={item.id}
                item={item}
                depth={rowDepth}
                indentationWidth={INDENTATION_WIDTH}
                indicator={INDICATOR}
                sortable={sortable}
                handlers={handlers}
                selected={item.kind === "task" && selectedPath === item.path}
              />
            );
          })}
        </ul>
      </SortableContext>
      {createPortal(
        <DragOverlay
          dropAnimation={null}
          modifiers={INDICATOR ? [alignOverlayToCheckbox] : undefined}
        >
          {activeId && activeItem ? (
            <TaskTreeDragOverlay
              item={activeItem}
              childCount={getChildCount(items, activeId) + 1}
              handlers={handlers}
            />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
} from "./TaskTreeRow";
import { TasksPlainTree } from "./TasksPlainTree";
import { TaskTreeAddComposerProvider } from "./TaskTreeAddComposerContext";
import type { TaskTreeAddComposerState } from "./TaskTreeAddComposerContext";
import { buildTaskTreeDisplayRows } from "./taskTreeDisplayRows";
import {
  TaskTreeActionsProvider,
  type TaskTreeActions,
  type TaskTreeEditState,
} from "./TaskTreeActionsContext";
import { parseTaskTreeId, type TaskTreeItems } from "./types";
import type { TasksComposerDraft } from "../TasksComposer";
import type { RefObject } from "react";
import { useTasksPanelStore } from "../../../store/tasksPanelStore";
import { taskListDropTargetAt } from "./taskListDropTarget";
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

type TasksTreeProps = {
  entries: readonly TaskIndexEntry[];
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  sortable: boolean;
  vaultTree: TreeNode | null | undefined;
  actions: TaskTreeActions;
  edit: TaskTreeEditState | null;
  completingPaths: ReadonlySet<string>;
  todayYmd: string;
  showListChip?: boolean;
  listColors?: Record<string, string>;
  onExpandPath?: (path: string) => void;
  /** Called after vault write; may return a Promise — kept under persisting lock until done. */
  onPersisted?: () => void | Promise<void>;
  /** Drop a dragged task onto a Tasks sidebar list (Inbox / named list). */
  onDropOnList?: (path: string, list: string) => void | Promise<void>;
  addComposerParentPath?: string | null;
  addDraft?: TasksComposerDraft;
  addTitleRef?: RefObject<HTMLTextAreaElement | null>;
  addLists?: string[];
  addListColors?: Record<string, string>;
  addLabelCatalog?: string[];
  onPatchAddDraft?: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitAddSubtask?: (parentPath: string) => void;
  onCancelAddSubtask?: () => void;
  onStartAddSubtask?: (parentPath: string) => void;
};

export const TasksSortableTree = memo(function TasksSortableTree(
  props: TasksTreeProps,
): ReactNode {
  if (!props.sortable) {
    return (
      <TasksPlainTree
        entries={props.entries}
        expanded={props.expanded}
        selectedPath={props.selectedPath}
        actions={props.actions}
        edit={props.edit}
        completingPaths={props.completingPaths}
        todayYmd={props.todayYmd}
        showListChip={props.showListChip}
        listColors={props.listColors}
        addComposerParentPath={props.addComposerParentPath}
        addDraft={props.addDraft}
        addTitleRef={props.addTitleRef}
        addLists={props.addLists}
        addListColors={props.addListColors}
        addLabelCatalog={props.addLabelCatalog}
        onPatchAddDraft={props.onPatchAddDraft}
        onSubmitAddSubtask={props.onSubmitAddSubtask}
        onCancelAddSubtask={props.onCancelAddSubtask}
        onStartAddSubtask={props.onStartAddSubtask}
      />
    );
  }
  return <SortableTaskTreeInner {...props} />;
});

const SortableTaskTreeInner = memo(function SortableTaskTreeInner({
  entries,
  expanded,
  selectedPath,
  vaultTree,
  actions,
  edit,
  completingPaths,
  todayYmd,
  showListChip = false,
  listColors = {},
  onExpandPath,
  onPersisted,
  onDropOnList,
  addComposerParentPath = null,
  addDraft,
  addTitleRef,
  addLists = [],
  addListColors = {},
  addLabelCatalog = [],
  onPatchAddDraft,
  onSubmitAddSubtask,
  onCancelAddSubtask,
  onStartAddSubtask,
}: TasksTreeProps): ReactNode {
  const [items, setItems] = useState<TaskTreeItems>(() =>
    taskEntriesToTreeItems(entries, expanded),
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  const persisting = useRef(false);
  const overIdRef = useRef<UniqueIdentifier | null>(null);
  const offsetLeftRef = useRef(0);
  const dragStartXRef = useRef(0);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const stopPointerTrackingRef = useRef<(() => void) | null>(null);
  const listDropTargetRef = useRef<string | null>(null);
  const setTaskListDropTarget = useTasksPanelStore(
    (s) => s.setTaskListDropTarget,
  );

  const stopPointerTracking = () => {
    stopPointerTrackingRef.current?.();
    stopPointerTrackingRef.current = null;
  };

  const clearListDropTarget = () => {
    listDropTargetRef.current = null;
    setTaskListDropTarget(null);
  };

  const syncListDropTarget = (clientX: number, clientY: number) => {
    lastPointerRef.current = { x: clientX, y: clientY };
    const next = taskListDropTargetAt(clientX, clientY);
    if (next === listDropTargetRef.current) return;
    listDropTargetRef.current = next;
    setTaskListDropTarget(next);
  };

  const startPointerTracking = (startX: number, startY: number) => {
    stopPointerTracking();
    dragStartXRef.current = startX;
    lastPointerRef.current = { x: startX, y: startY };
    const onPointerMove = (event: PointerEvent) => {
      const x = event.clientX - dragStartXRef.current;
      setOffsetLeft(x);
      offsetLeftRef.current = x;
      syncListDropTarget(event.clientX, event.clientY);
    };
    document.addEventListener("pointermove", onPointerMove);
    stopPointerTrackingRef.current = () => {
      document.removeEventListener("pointermove", onPointerMove);
    };
  };

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

  // 8px before drag activates — explicit for WebView / Tauri.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const sortedIds = useMemo(
    () => flattenedItems.map(({ id }) => id),
    [flattenedItems],
  );

  const displayItems = useMemo(
    () => buildTaskTreeDisplayRows(flattenedItems, addComposerParentPath),
    [flattenedItems, addComposerParentPath],
  );

  const addComposerState = useMemo((): TaskTreeAddComposerState | null => {
    if (
      !addDraft ||
      !addTitleRef ||
      !onPatchAddDraft ||
      !onSubmitAddSubtask ||
      !onCancelAddSubtask ||
      !onStartAddSubtask
    ) {
      return null;
    }
    return {
      addComposerParentPath,
      draft: addDraft,
      lists: addLists,
      listColors: addListColors,
      labelCatalog: addLabelCatalog,
      titleRef: addTitleRef,
      indentationWidth: INDENTATION_WIDTH,
      onPatchDraft: onPatchAddDraft,
      onSubmit: onSubmitAddSubtask,
      onCancel: onCancelAddSubtask,
      onStartAddSubtask,
    };
  }, [
    addComposerParentPath,
    addDraft,
    addTitleRef,
    addLists,
    addListColors,
    addLabelCatalog,
    onPatchAddDraft,
    onSubmitAddSubtask,
    onCancelAddSubtask,
    onStartAddSubtask,
  ]);

  const activeItem = activeId
    ? flattenedItems.find(({ id }) => id === activeId)
    : null;

  const resetState = () => {
    stopPointerTracking();
    clearListDropTarget();
    setOverId(null);
    overIdRef.current = null;
    setActiveId(null);
    setOffsetLeft(0);
    offsetLeftRef.current = 0;
    document.body.style.setProperty("cursor", "");
  };

  const handleDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const startX =
      activatorEvent && "clientX" in activatorEvent
        ? Number(activatorEvent.clientX)
        : 0;
    const startY =
      activatorEvent && "clientY" in activatorEvent
        ? Number(activatorEvent.clientY)
        : 0;
    startPointerTracking(startX, startY);
    clearListDropTarget();
    setActiveId(active.id);
    setOverId(active.id);
    overIdRef.current = active.id;
    offsetLeftRef.current = 0;
    setOffsetLeft(0);
    document.body.style.setProperty("cursor", "grabbing");
  };

  const handleDragMove = ({ delta }: DragMoveEvent) => {
    setOffsetLeft(delta.x);
    offsetLeftRef.current = delta.x;
  };

  const handleDragOver = ({ over }: DragOverEvent) => {
    const nextOverId = over?.id ?? null;
    setOverId(nextOverId);
    if (nextOverId != null) {
      overIdRef.current = nextOverId;
    }
  };

  const handleDragEnd = ({ active, over, delta }: DragEndEvent) => {
    const fullFlat = flattenTree(items);
    const listDrop =
      listDropTargetRef.current ??
      taskListDropTargetAt(
        lastPointerRef.current.x,
        lastPointerRef.current.y,
      );

    if (listDrop && onDropOnList) {
      const meta = parseTaskTreeId(active.id);
      const activePath = meta?.kind === "task" ? meta.path : null;
      resetState();
      setItems(taskEntriesToTreeItems(entries, expanded));
      if (activePath) {
        persisting.current = true;
        void (async () => {
          try {
            await onDropOnList(activePath, listDrop);
          } catch (err) {
            console.error("Task list drop failed", err);
            setItems(taskEntriesToTreeItems(entries, expanded));
          } finally {
            persisting.current = false;
          }
        })();
      }
      return;
    }

    // Indicator ghost is 8px — pointer often leaves droppables on release.
    const resolvedOverId = over?.id ?? overIdRef.current ?? overId;
    // DragEnd delta.x is often 0; prefer last drag-move offset (ref > state > delta).
    const effectiveOffset = offsetLeftRef.current || offsetLeft || delta.x;
    let proj =
      resolvedOverId != null
        ? getProjection(
            flattenedItems,
            active.id,
            resolvedOverId,
            effectiveOffset,
            INDENTATION_WIDTH,
          )
        : null;
    // Last rendered projection (before drop) when WebKit zeroes offset on release.
    if (
      proj &&
      effectiveOffset === 0 &&
      projected &&
      String(resolvedOverId) === String(overId)
    ) {
      proj = projected;
    }
    if (!proj || resolvedOverId == null) {
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
    <TaskTreeActionsProvider actions={actions}>
      <TaskTreeAddComposerProvider value={addComposerState}>
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
            {displayItems.map((item) => {
              const rowDepth =
                item.id === activeId && projected
                  ? projected.depth
                  : item.depth;
              const itemId = String(item.id);
              const isEditing =
                edit != null && String(edit.editingId) === itemId;
              return (
                <SortableTaskTreeRow
                  key={itemId}
                  id={item.id}
                  item={item}
                  depth={rowDepth}
                  indentationWidth={INDENTATION_WIDTH}
                  indicator={INDICATOR}
                  sortable
                  selected={item.kind === "task" && selectedPath === item.path}
                  isCompleting={completingPaths.has(item.path)}
                  isEditing={isEditing}
                  edit={isEditing && edit ? edit : null}
                  todayYmd={todayYmd}
                  showListChip={showListChip}
                  listColors={listColors}
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
                todayYmd={todayYmd}
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      </TaskTreeAddComposerProvider>
    </TaskTreeActionsProvider>
  );
});

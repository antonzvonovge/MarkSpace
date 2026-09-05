import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TreeNode } from "../../lib/vaultApi";
import { isVaultDocumentPath } from "../../lib/vaultApi";
import { vaultProjectRootOf } from "../../lib/diaryNotes";
import { isVaultProjectFolder } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import {
  flattenVisibleWorkspace,
  type FlattenedVaultRow,
  VAULT_PATH,
} from "./vaultTreeFlatten";
import {
  WORKSPACE_LIST_DROPPABLE_ID,
  dropIndicatorsEqual,
  hitTestVirtualRow,
  placementFromPointerRatio,
  resolveVaultDrop,
  type VaultDropIndicator,
} from "./vaultTreeDnD";
import {
  VaultTreeDragChip,
  VaultTreeRow,
  projectMetaForPath,
  type PromptKind,
  type ProjectPropsMap,
  type VaultDropLine,
} from "./VaultTreeRow";
import {
  dispatchVaultTreePointerDrop,
  normalizeVaultTreeDragPath,
} from "../../lib/vaultTreeDrag";

const ROW_HEIGHT = 28;
const ROOT_ROW_HEIGHT = 28;
const OVERSCAN = 12;

/** Chip sits just right and below the pointer (ignore grab point on the wide row). */
const CHIP_CURSOR_GAP_X = 12;
const CHIP_CURSOR_GAP_Y = 16;

const placeChipByCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const cursor = getEventCoordinates(activatorEvent);
  if (!cursor) return transform;
  return {
    ...transform,
    x:
      transform.x +
      (cursor.x - draggingNodeRect.left) +
      CHIP_CURSOR_GAP_X,
    y:
      transform.y +
      (cursor.y - draggingNodeRect.top) +
      CHIP_CURSOR_GAP_Y,
  };
};

const measuring = {
  droppable: {
    strategy: MeasuringStrategy.WhileDragging,
  },
};

/** Prefer the list host droppable so we never need per-row droppables. */
const listCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const listHit = hits.find((c) => c.id === WORKSPACE_LIST_DROPPABLE_ID);
  if (listHit) return [listHit];
  return hits;
};

export type WorkspaceTreeProps = {
  tree: TreeNode;
  expandedPaths: string[];
  projectPropertiesByPath: ProjectPropsMap;
  unresolvedCounts: Map<string, number>;
  renamingPath: string | null;
  osDropRowPath: string | null;
  scrollParentRef: React.RefObject<HTMLElement | null>;
  onToggleExpanded: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onOpenFolder: (
    path: string,
    options?: { preview?: boolean; replaceActive?: boolean },
  ) => void;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  onSelectInTree: (path: string, isDir: boolean) => void;
  onContextMenu: (menu: {
    x: number;
    y: number;
    path: string;
    name: string;
    isDir: boolean;
    isFavorite: boolean;
  }) => void;
  onRenameCommit: (path: string, nextName: string) => void;
  onRenameCancel: () => void;
  onCreate: (kind: PromptKind) => void;
  onLocateActive: () => void;
  onCollapseAll: () => void;
  favoriteSet: Set<string>;
  onMoved?: (from: string, next: string | null) => void;
};

function isUnsupported(isDir: boolean, path: string): boolean {
  return !isDir && !isVaultDocumentPath(path);
}

/**
 * Rows have a fixed height per density, so the virtualizer needs no DOM
 * measuring — it only needs the two heights CSS gives them.
 */
type RowHeights = { row: number; root: number };

function readCssPx(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readRowHeights(): RowHeights {
  return {
    row: readCssPx("--tree-row-height", ROW_HEIGHT),
    root: readCssPx("--tree-root-row-height", ROOT_ROW_HEIGHT),
  };
}

/**
 * Offset of `el` inside `parent`'s padding box, read from layout (`offsetTop`)
 * rather than rects, so the result never depends on `scrollTop` and cannot
 * drift while the list is scrolled.
 */
function offsetWithinScrollParent(
  el: HTMLElement,
  parent: HTMLElement,
): number {
  // `offsetTop` is already measured from the offsetParent's padding box.
  if (el.offsetParent === parent) return el.offsetTop;
  // offsetTop values are comparable only within one offsetParent; the sidebar
  // scroll container is static, so it shares its own with the list.
  if (el.offsetParent === parent.offsetParent) {
    return el.offsetTop - parent.offsetTop - parent.clientTop;
  }
  // Positioned element in between: rects need scrollTop to stay stable.
  return (
    el.getBoundingClientRect().top -
    parent.getBoundingClientRect().top +
    parent.scrollTop -
    parent.clientTop
  );
}

function WorkspaceListHost({
  listRef,
  className,
  style,
  children,
}: {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: WORKSPACE_LIST_DROPPABLE_ID,
  });
  return (
    <div
      ref={(node) => {
        listRef.current = node;
        setNodeRef(node);
      }}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}

export const WorkspaceTree = memo(function WorkspaceTree({
  tree,
  expandedPaths,
  projectPropertiesByPath,
  unresolvedCounts,
  renamingPath,
  osDropRowPath,
  scrollParentRef,
  onToggleExpanded,
  onSelectFolder,
  onOpenFolder,
  onOpenNote,
  onSelectInTree,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onCreate,
  onLocateActive,
  onCollapseAll,
  favoriteSet,
  onMoved,
}: WorkspaceTreeProps): ReactNode {
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const selectedFolderExplicit = useVaultStore((s) => s.selectedFolderExplicit);
  const treeSelectedFilePath = useVaultStore((s) => s.treeSelectedFilePath);
  const treeSelectionVisible = useVaultStore((s) => s.treeSelectionVisible);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const nestTreeEntryUnderNote = useVaultStore((s) => s.nestTreeEntryUnderNote);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);
  const [heights, setHeights] = useState<RowHeights>(readRowHeights);

  const rows = useMemo(
    () => flattenVisibleWorkspace(tree, expandedPaths),
    [tree, expandedPaths],
  );
  const rowsByPath = useMemo(() => {
    const map = new Map<string, FlattenedVaultRow>();
    for (const row of rows) map.set(row.path, row);
    return map;
  }, [rows]);
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [dropIndicator, setDropIndicator] = useState<VaultDropIndicator | null>(
    null,
  );
  const dropIndicatorRef = useRef<VaultDropIndicator | null>(null);
  const pointerXRef = useRef(0);
  const pointerYRef = useRef(0);
  const stopPointerTrackingRef = useRef<(() => void) | null>(null);
  const scrollMarginRef = useRef(scrollMargin);
  scrollMarginRef.current = scrollMargin;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const stopPointerTracking = useCallback(() => {
    stopPointerTrackingRef.current?.();
    stopPointerTrackingRef.current = null;
  }, []);

  const startPointerTracking = useCallback(
    (clientX: number, clientY: number) => {
      stopPointerTrackingRef.current?.();
      pointerXRef.current = clientX;
      pointerYRef.current = clientY;
      const onMove = (ev: PointerEvent) => {
        pointerXRef.current = ev.clientX;
        pointerYRef.current = ev.clientY;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      stopPointerTrackingRef.current = () => {
        window.removeEventListener("pointermove", onMove);
      };
    },
    [],
  );

  const commitDropIndicator = useCallback((next: VaultDropIndicator | null) => {
    if (dropIndicatorsEqual(dropIndicatorRef.current, next)) return;
    dropIndicatorRef.current = next;
    setDropIndicator(next);
  }, []);

  useLayoutEffect(() => {
    const apply = () => {
      const next = readRowHeights();
      setHeights((prev) =>
        prev.row === next.row && prev.root === next.root ? prev : next,
      );
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density"],
    });
    return () => obs.disconnect();
  }, []);

  // A stale scrollMargin does not move the rows (their transform subtracts it
  // again) but it does shift the visible range, leaving a blank strip. Sections
  // above the tree mount, unmount and resize on their own, so track presence,
  // size and — because a section can resize mid-scroll — the scroll itself.
  useLayoutEffect(() => {
    let setupRaf = 0;
    let updateRaf = 0;
    let host: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;

    const update = () => {
      const parent = scrollParentRef.current;
      const list = listRef.current;
      if (!parent || !list) return;
      const next = offsetWithinScrollParent(list, parent);
      setScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    const schedule = () => {
      if (updateRaf) return;
      updateRaf = requestAnimationFrame(() => {
        updateRaf = 0;
        update();
      });
    };

    const setup = () => {
      const parent = scrollParentRef.current;
      // The scroll host is a callback ref on an ancestor, and React attaches
      // those after the layout effects of its children — so on mount it can
      // still be missing and we have to wait for it.
      if (!parent || !listRef.current) {
        setupRaf = requestAnimationFrame(setup);
        return;
      }
      host = parent;
      setScrollHost(parent);
      const observeAll = () => {
        ro?.disconnect();
        ro?.observe(parent);
        for (const child of parent.children) ro?.observe(child);
      };
      ro = new ResizeObserver(update);
      observeAll();
      mo = new MutationObserver(() => {
        observeAll();
        update();
      });
      mo.observe(parent, { childList: true });
      parent.addEventListener("scroll", schedule, { passive: true });
      update();
    };
    setup();

    return () => {
      cancelAnimationFrame(setupRaf);
      cancelAnimationFrame(updateRaf);
      ro?.disconnect();
      mo?.disconnect();
      host?.removeEventListener("scroll", schedule);
    };
  }, [scrollParentRef]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    // `scrollHost` state exists so finding the host late still triggers the
    // render that lets the virtualizer attach to it.
    getScrollElement: () => scrollHost ?? scrollParentRef.current,
    // Row 0 is the vault root, which stays 28px tall in compact density.
    estimateSize: (index) => (index === 0 ? heights.root : heights.row),
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => rows[index]?.path ?? index,
  });
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;

  // `estimateSize` is not part of the measurement cache key, so a density
  // switch is the only thing that has to invalidate it.
  const heightsRef = useRef(heights);
  useLayoutEffect(() => {
    if (heightsRef.current === heights) return;
    heightsRef.current = heights;
    virtualizer.measure();
  }, [heights, virtualizer]);

  const updateDropFromPointer = useCallback(
    (activeDragId: UniqueIdentifier) => {
      const list = listRef.current;
      if (!list) {
        commitDropIndicator(null);
        return;
      }
      const listRect = list.getBoundingClientRect();
      const y = pointerYRef.current;
      const parent = scrollParentRef.current;
      const parentRect = parent?.getBoundingClientRect();
      if (
        parentRect &&
        (y < parentRect.top || y > parentRect.bottom)
      ) {
        commitDropIndicator(null);
        return;
      }

      const vItems = virtualizerRef.current.getVirtualItems();
      const hit = hitTestVirtualRow(
        y,
        listRect.top,
        scrollMarginRef.current,
        vItems.map((v) => ({
          index: v.index,
          start: v.start,
          size: v.size,
        })),
      );
      if (!hit) {
        commitDropIndicator(null);
        return;
      }
      const overRow = rowsRef.current[hit.index];
      if (!overRow || overRow.path === String(activeDragId)) {
        commitDropIndicator(null);
        return;
      }
      const placement = placementFromPointerRatio(overRow, hit.ratio);
      commitDropIndicator({ path: overRow.path, placement });
    },
    [commitDropIndicator, scrollParentRef],
  );

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const activator = event.activatorEvent;
      const x =
        activator && "clientX" in activator
          ? (activator as PointerEvent).clientX
          : 0;
      const y =
        activator && "clientY" in activator
          ? (activator as PointerEvent).clientY
          : 0;
      startPointerTracking(x, y);
      setActiveId(event.active.id);
      dropIndicatorRef.current = null;
      setDropIndicator(null);
      document.body.classList.add("is-vault-tree-dragging");
    },
    [startPointerTracking],
  );

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      if (event.over == null) {
        commitDropIndicator(null);
        return;
      }
      updateDropFromPointer(event.active.id);
    },
    [commitDropIndicator, updateDropFromPointer],
  );

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (event.over == null) {
        commitDropIndicator(null);
        return;
      }
      updateDropFromPointer(event.active.id);
    },
    [commitDropIndicator, updateDropFromPointer],
  );

  const clearDragState = useCallback(() => {
    stopPointerTracking();
    setActiveId(null);
    dropIndicatorRef.current = null;
    setDropIndicator(null);
    document.body.classList.remove("is-vault-tree-dragging");
  }, [stopPointerTracking]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-vault-tree-dragging");
    };
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const from = String(event.active.id);
      const indicator = dropIndicatorRef.current;
      const clientX = pointerXRef.current;
      const clientY = pointerYRef.current;
      const fromRow = rowsRef.current.find((r) => r.path === from);
      clearDragState();

      // Tree-internal drop (reorder / nest).
      if (indicator && from !== indicator.path) {
        const drop = resolveVaultDrop(
          rows,
          from,
          indicator.path,
          indicator.placement,
        );
        if (!drop) return;
        void (async () => {
          const next =
            drop.kind === "nest-note"
              ? await nestTreeEntryUnderNote(
                  drop.from,
                  drop.targetPath,
                  drop.toIndex,
                )
              : await moveTreeEntry(drop.from, drop.targetPath, drop.toIndex);
          onMoved?.(from, next);
        })();
        return;
      }

      // Outside the list: deliver to chat composer / note editor (no HTML5 DnD).
      const parent = scrollParentRef.current;
      const parentRect = parent?.getBoundingClientRect();
      const overTree =
        parentRect != null &&
        clientX >= parentRect.left &&
        clientX <= parentRect.right &&
        clientY >= parentRect.top &&
        clientY <= parentRect.bottom;
      if (overTree) return;

      const path = normalizeVaultTreeDragPath(from, Boolean(fromRow?.isDir));
      dispatchVaultTreePointerDrop(path, clientX, clientY);
    },
    [
      rows,
      moveTreeEntry,
      nestTreeEntryUnderNote,
      onMoved,
      clearDragState,
      scrollParentRef,
    ],
  );

  const onDragCancel = useCallback(() => {
    clearDragState();
  }, [clearDragState]);

  const activeRow = activeId
    ? rowsByPath.get(String(activeId)) ?? null
    : null;
  const activeIdStr = activeId != null ? String(activeId) : null;
  const activeChipMeta = activeRow
    ? (() => {
        const meta = projectMetaForPath(
          activeRow.path,
          projectPropertiesByPath,
        );
        if (isVaultProjectFolder(activeRow.path, activeRow.isDir)) {
          const props = projectPropertiesByPath[activeRow.path];
          return {
            projectType: props?.projectType,
            learningLanguage: props?.learningLanguage,
          };
        }
        return {
          projectType: meta.projectType,
          learningLanguage: meta.learningLanguage,
        };
      })()
    : null;

  const renderRow = (
    row: FlattenedVaultRow,
    opts?: { style?: CSSProperties },
  ) => {
    const path = row.path;
    const isDir = row.isDir;
    const isVault = path === VAULT_PATH;
    const selected =
      treeSelectionVisible &&
      isDir &&
      selectedFolderExplicit &&
      selectedFolderPath === path;
    const active =
      treeSelectionVisible &&
      !isDir &&
      !selectedFolderExplicit &&
      (treeSelectedFilePath ?? activePath) === path;
    const isOpen = isVault || expandedSet.has(path);
    const meta = projectMetaForPath(path, projectPropertiesByPath);
    const projectRoot = vaultProjectRootOf(path);
    const projectColor =
      projectRoot && projectPropertiesByPath[projectRoot]?.color
        ? projectPropertiesByPath[projectRoot]!.color
        : meta.projectColor;

    const dropLine: VaultDropLine =
      dropIndicator != null &&
      dropIndicator.path === path &&
      activeIdStr !== path
        ? dropIndicator.placement
        : null;

    // While dragging, only the active row keeps useDraggable so other rows
    // unsubscribe from dnd-kit context and skip pointer-move re-renders.
    const staticRow = activeIdStr != null && activeIdStr !== path;

    return (
      <VaultTreeRow
        key={path}
        path={path}
        name={row.name}
        isDir={isDir}
        hasChildren={row.hasChildren}
        depth={row.depth}
        isOpen={isOpen}
        dropLine={dropLine}
        isDragStub={activeIdStr != null && activeIdStr === path}
        isDropTarget={false}
        isDragging={false}
        isVault={isVault}
        selected={selected}
        active={active}
        renaming={renamingPath === path}
        osDropHighlight={osDropRowPath !== null && path === osDropRowPath}
        openComments={unresolvedCounts.get(path) ?? 0}
        projectColor={projectColor}
        projectType={
          isVaultProjectFolder(path, isDir)
            ? projectPropertiesByPath[path]?.projectType
            : meta.projectType
        }
        learningLanguage={
          projectPropertiesByPath[path]?.projectType === "languageLearning"
            ? projectPropertiesByPath[path]?.learningLanguage
            : meta.learningLanguage
        }
        staticRow={staticRow}
        style={opts?.style}
        onToggle={() => {
          if (isVault) return;
          onToggleExpanded(path);
        }}
        onRowClick={(e: MouseEvent) => {
          if (renamingPath === path) return;
          if (isDir) {
            if (isVault || !path) {
              onSelectFolder(path);
              return;
            }
            void onOpenFolder(path, {
              preview: !(e.ctrlKey || e.metaKey),
            });
            return;
          }
          if (isUnsupported(isDir, path)) {
            onSelectInTree(path, false);
            return;
          }
          void onOpenNote(path, {
            preview: !(e.ctrlKey || e.metaKey),
          });
        }}
        onOpenPinned={() => {
          void onOpenNote(path, { preview: false });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu({
            x: e.clientX,
            y: e.clientY,
            path,
            name: row.name,
            isDir,
            isFavorite: path !== "" && favoriteSet.has(path),
          });
          onSelectInTree(path, isDir);
        }}
        onRenameCommit={(nextName) => onRenameCommit(path, nextName)}
        onRenameCancel={onRenameCancel}
        onCreate={onCreate}
        onLocateActive={onLocateActive}
        onCollapseAll={onCollapseAll}
      />
    );
  };

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={listCollision}
      measuring={measuring}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <WorkspaceListHost
        listRef={listRef}
        className={
          activeId != null
            ? "workspace-virtual-tree is-tree-dragging"
            : "workspace-virtual-tree"
        }
        style={{
          height: totalSize,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((vItem) => {
          const row = rows[vItem.index];
          if (!row) return null;
          const lineHost =
            dropIndicator != null &&
            dropIndicator.path === row.path &&
            (dropIndicator.placement === "before" ||
              dropIndicator.placement === "after") &&
            activeIdStr !== row.path;
          return (
            <div
              key={row.path}
              data-index={vItem.index}
              className={
                lineHost
                  ? "workspace-virtual-row is-drop-line-host"
                  : "workspace-virtual-row"
              }
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start - scrollMargin}px)`,
              }}
            >
              {renderRow(row)}
            </div>
          );
        })}
      </WorkspaceListHost>
      <DragOverlay dropAnimation={null} modifiers={[placeChipByCursor]}>
        {activeRow && activeChipMeta ? (
          <VaultTreeDragChip
            path={activeRow.path}
            name={activeRow.name}
            isDir={activeRow.isDir}
            projectType={activeChipMeta.projectType}
            learningLanguage={activeChipMeta.learningLanguage}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

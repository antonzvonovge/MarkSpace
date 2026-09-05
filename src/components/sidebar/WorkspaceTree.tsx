import {
  memo,
  useCallback,
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
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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
import { resolveVaultDrop } from "./vaultTreeDnD";
import {
  VaultTreeRow,
  projectMetaForPath,
  type PromptKind,
  type ProjectPropsMap,
} from "./VaultTreeRow";

const ROW_HEIGHT = 28;
const OVERSCAN = 16;

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

  const rows = useMemo(
    () => flattenVisibleWorkspace(tree, expandedPaths),
    [tree, expandedPaths],
  );
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const rowIds = useMemo(() => rows.map((r) => r.path), [rows]);

  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    const parent = scrollParentRef.current;
    if (!list || !parent) return;
    const update = () => {
      const parentTop = parent.getBoundingClientRect().top;
      const listTop = list.getBoundingClientRect().top;
      setScrollMargin(listTop - parentTop + parent.scrollTop);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    for (const child of parent.children) ro.observe(child);
    return () => ro.disconnect();
  }, [scrollParentRef, rows.length, expandedPaths]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => rows[index]?.path ?? index,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rows.length, scrollMargin, virtualizer]);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
    setOverId(event.active.id);
  }, []);

  const onDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over?.id ?? null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const from = String(event.active.id);
      const over = event.over ? String(event.over.id) : null;
      setActiveId(null);
      setOverId(null);
      if (!over || from === over) return;
      const drop = resolveVaultDrop(rows, from, over);
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
    },
    [rows, moveTreeEntry, nestTreeEntryUnderNote, onMoved],
  );

  const onDragCancel = useCallback(() => {
    setActiveId(null);
    setOverId(null);
  }, []);

  const activeRow = activeId
    ? rows.find((r) => r.path === String(activeId))
    : null;

  const renderRow = (
    row: FlattenedVaultRow,
    opts?: { overlay?: boolean; style?: CSSProperties },
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

    return (
      <VaultTreeRow
        key={path}
        path={path}
        name={row.name}
        isDir={isDir}
        hasChildren={row.hasChildren}
        depth={row.depth}
        isOpen={isOpen}
        isDropTarget={
          !opts?.overlay &&
          overId != null &&
          String(overId) === path &&
          activeId != null &&
          String(activeId) !== path
        }
        isDragging={Boolean(opts?.overlay)}
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
        staticRow={Boolean(opts?.overlay)}
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
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
        <div
          ref={listRef}
          className="workspace-virtual-tree"
          style={{
            height: totalSize,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((vItem) => {
            const row = rows[vItem.index];
            if (!row) return null;
            return (
              <div
                key={row.path}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
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
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeRow
          ? renderRow(activeRow, {
              overlay: true,
              style: { opacity: 0.92, cursor: "grabbing" },
            })
          : null}
      </DragOverlay>
    </DndContext>
  );
});

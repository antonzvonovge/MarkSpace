import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FcDocument } from "react-icons/fc";
import { ConfirmDialog, PromptDialog } from "../AppDialog";
import { EyeIcon, PdfIcon, TagIcon, VaultSectionIcon } from "../treeIcons";
import { SectionCollapseChevron } from "./SectionCollapseChevron";
import {
  WorkspaceHeaderActions,
  type TreeCreateKind,
} from "../TreeToolbar";
import { noteLabel } from "../../lib/tagGraph";
import {
  UNTAGGED_SELECTION,
  addTagToNotes,
  applyTagPrefixToNotes,
  buildTagTree,
  collectTagDocumentPaths,
  documentsForSelection,
  flattenTagView,
  tagHasPrefix,
  type TagFlatRow,
} from "../../lib/tagTree";
import { sanitizeTagName } from "../../lib/tagName";
import { getNoteTags, setNoteTags } from "../../lib/noteFrontmatter";
import {
  getFileTags,
  listNoteTags,
  listVaultTags,
  readNote,
  retagPrefix,
  setFileTags,
  writeNote,
  type NoteTags,
  type TreeNode,
} from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { useSidebarUiStore } from "../../store/sidebarUiStore";
import {
  hitTestVirtualRow,
  type VirtualRowGeom,
} from "./vaultTreeDnD";
import { useTagFileSlot } from "./tagFileSlot";

const OVERSCAN = 12;
const TAG_LIST_ID = "tag-tree-list";

const listCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const listHit = hits.find((hit) => hit.id === TAG_LIST_ID);
  if (listHit) return [listHit];
  return hits;
};

function readRowHeight(): number {
  if (typeof document === "undefined") return 28;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--tree-row-height")
    .trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 28;
}

function offsetWithinScrollParent(el: HTMLElement, parent: HTMLElement): number {
  if (el.offsetParent === parent) return el.offsetTop;
  if (el.offsetParent === parent.offsetParent) {
    return el.offsetTop - parent.offsetTop - parent.clientTop;
  }
  return (
    el.getBoundingClientRect().top -
    parent.getBoundingClientRect().top +
    parent.scrollTop -
    parent.clientTop
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "tree-chevron-icon is-open" : "tree-chevron-icon"}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 3.75 10.25 8 6 12.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TAGS_COLLAPSED_KEY = "markspace-tags-section-collapsed-v1";

function loadTagsCollapsed(): boolean {
  try {
    return localStorage.getItem(TAGS_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveTagsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(TAGS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

function rowPad(depth: number): CSSProperties {
  return {
    paddingLeft: `calc(var(--tree-pad-x) + ${depth} * var(--tree-indent))`,
    paddingRight: "var(--tree-pad-x)",
  };
}

async function persistAddedTag(path: string, tag: string): Promise<void> {
  if (path.toLowerCase().endsWith(".pdf")) {
    const current = await getFileTags(path);
    if (current.some((item) => item.toLowerCase() === tag.toLowerCase())) return;
    await setFileTags(path, [...current, tag]);
    return;
  }
  const markdown = await readNote(path);
  const current = getNoteTags(markdown);
  if (current.some((item) => item.toLowerCase() === tag.toLowerCase())) return;
  await writeNote(path, setNoteTags(markdown, [...current, tag]));
}

function publishVaultTags(tags: string[]) {
  useVaultStore.setState({ vaultTags: tags });
}

export type TagTreeViewProps = {
  tree: TreeNode;
  scrollParentRef: React.RefObject<HTMLElement | null>;
  showNoteTitles?: boolean;
  titlesByPath?: Readonly<Record<string, string>>;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  onCreate: (kind: TreeCreateKind) => void;
};

export const TagTreeView = memo(function TagTreeView({
  tree,
  scrollParentRef,
  showNoteTitles = false,
  titlesByPath,
  onOpenNote,
  onCreate,
}: TagTreeViewProps): ReactNode {
  const activePath = useVaultStore((s) => s.activePath);
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const tagExpandedPaths = useSidebarUiStore((s) => s.tagExpandedPaths);
  const selectedTagPath = useSidebarUiStore((s) => s.selectedTagPath);
  const hideSubtagNotes = useSidebarUiStore((s) => s.hideSubtagNotes);
  const toggleTagExpanded = useSidebarUiStore((s) => s.toggleTagExpanded);
  const collapseTagTree = useSidebarUiStore((s) => s.collapseTagTree);
  const expandTagPaths = useSidebarUiStore((s) => s.expandTagPaths);
  const setTagExpandedPaths = useSidebarUiStore((s) => s.setTagExpandedPaths);
  const setSelectedTagPath = useSidebarUiStore((s) => s.setSelectedTagPath);
  const setHideSubtagNotes = useSidebarUiStore((s) => s.setHideSubtagNotes);

  const [tagsCollapsed, setTagsCollapsed] = useState(loadTagsCollapsed);
  const [noteTags, setNoteTags] = useState<NoteTags[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(
    null,
  );
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [dropTag, setDropTag] = useState<string | null>(null);
  const [rowHeight, setRowHeight] = useState(readRowHeight);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const noteTagsRef = useRef(noteTags);
  noteTagsRef.current = noteTags;

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await listNoteTags();
      if (id === requestId.current) setNoteTags(next);
    } catch (e) {
      if (id !== requestId.current) return;
      useVaultStore.setState({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, vaultTags]);

  const documentPaths = useMemo(() => collectTagDocumentPaths(tree), [tree]);
  const tagNodes = useMemo(
    () => buildTagTree(noteTags.flatMap((entry) => entry.tags)),
    [noteTags],
  );
  const rows = useMemo(
    () =>
      flattenTagView({
        tree: tagNodes,
        expanded: tagExpandedPaths,
        notes: noteTags,
        documentPaths,
        selection: selectedTagPath,
        hideSubtagNotes,
        includeDocuments: false,
      }),
    [
      tagNodes,
      tagExpandedPaths,
      noteTags,
      documentPaths,
      selectedTagPath,
      hideSubtagNotes,
    ],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const visibleRows = useMemo(
    () => (tagsCollapsed ? [] : rows),
    [tagsCollapsed, rows],
  );

  useLayoutEffect(() => {
    const apply = () => {
      const next = readRowHeight();
      setRowHeight((prev) => (prev === next ? prev : next));
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-density"],
    });
    return () => obs.disconnect();
  }, []);

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
    count: visibleRows.length,
    getScrollElement: () => scrollHost ?? scrollParentRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    scrollMargin,
    getItemKey: (index) => visibleRows[index]?.key ?? index,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const locateActive = useCallback(() => {
    const active = useVaultStore.getState().activePath;
    if (!active || active.startsWith("markspace:")) return;
    const entry = noteTagsRef.current.find((item) => item.path === active);
    const tag = entry?.tags.find((item) => item.trim()) ?? "";
    if (!tag) {
      setSelectedTagPath(UNTAGGED_SELECTION);
      return;
    }
    const parts = tag.split("/").filter(Boolean);
    const ancestors: string[] = [];
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
      ancestors.push(acc);
    }
    if (ancestors.length) expandTagPaths(ancestors);
    setSelectedTagPath(tag);
  }, [expandTagPaths, setSelectedTagPath]);

  const applyPrefix = useCallback(
    async (from: string, to: string | null) => {
      const snapshot = noteTagsRef.current;
      setNoteTags(applyTagPrefixToNotes(snapshot, from, to));
      const expanded = useSidebarUiStore.getState().tagExpandedPaths;
      setTagExpandedPaths(
        expanded.flatMap((path) => {
          if (!tagHasPrefix(path, from)) return [path];
          if (to == null) return [];
          return [`${to}${path.slice(from.length)}`];
        }),
      );
      if (
        selectedTagPath &&
        selectedTagPath !== UNTAGGED_SELECTION &&
        tagHasPrefix(selectedTagPath, from)
      ) {
        if (to == null) setSelectedTagPath(null);
        else setSelectedTagPath(`${to}${selectedTagPath.slice(from.length)}`);
      }
      try {
        const next = await retagPrefix(from, to);
        setNoteTags(next);
        const catalog = await listVaultTags();
        publishVaultTags(catalog);
      } catch (e) {
        useVaultStore.setState({
          error: e instanceof Error ? e.message : String(e),
        });
        try {
          setNoteTags(await listNoteTags());
        } catch {
          setNoteTags(snapshot);
        }
      }
    },
    [selectedTagPath, setSelectedTagPath, setTagExpandedPaths],
  );

  const addTag = useCallback(async (path: string, tag: string) => {
    const snapshot = noteTagsRef.current;
    const next = addTagToNotes(snapshot, path, tag);
    if (next === snapshot) return;
    setNoteTags(next);
    try {
      await persistAddedTag(path, tag);
      publishVaultTags(await listVaultTags());
    } catch (e) {
      setNoteTags(snapshot);
      useVaultStore.setState({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const tagUnderPointer = useCallback(
    (clientY: number): string | null => {
      const list = listRef.current;
      if (!list) return null;
      const items: VirtualRowGeom[] = virtualizer.getVirtualItems().map((item) => ({
        index: item.index,
        start: item.start,
        size: item.size,
      }));
      const hit = hitTestVirtualRow(
        clientY,
        list.getBoundingClientRect().top,
        scrollMargin,
        items,
      );
      if (!hit) return null;
      const row = rowsRef.current[hit.index];
      return row?.kind === "tag" ? row.path : null;
    },
    [scrollMargin, virtualizer],
  );

  const onDragStart = useCallback((_event: DragStartEvent) => {
    setDropTag(null);
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const activator = event.activatorEvent;
      if (!activator || !("clientY" in activator)) {
        setDropTag(null);
        return;
      }
      const clientY = (activator as PointerEvent).clientY + event.delta.y;
      setDropTag(tagUnderPointer(clientY));
    },
    [tagUnderPointer],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const target = dropTag;
      setDropTag(null);
      const path = event.active.data.current?.path;
      if (typeof path !== "string" || !target) return;
      void addTag(path, target);
    },
    [addTag, dropTag],
  );

  const onDragCancel = useCallback(() => {
    setDropTag(null);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={listCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div
        className="tree-row tree-folder-row is-vault-root"
        style={rowPad(0)}
        onClick={() => setSelectedTagPath(null)}
      >
        <SectionCollapseChevron
          open={!tagsCollapsed}
          label="Tags"
          onToggle={() => {
            setTagsCollapsed((prev) => {
              const next = !prev;
              saveTagsCollapsed(next);
              return next;
            });
          }}
        />
        <span className="tree-node-icon" aria-hidden>
          <VaultSectionIcon />
        </span>
        <span className="tree-node-label">{tree.name || "Vault"}</span>
        <div className="workspace-root-actions">
          <WorkspaceHeaderActions
            onCreate={onCreate}
            onLocateActive={locateActive}
            onCollapseAll={collapseTagTree}
          />
        </div>
      </div>
      <TagListHost listRef={listRef} height={virtualizer.getTotalSize()}>
        {virtualItems.map((item) => {
          const row = visibleRows[item.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              className="workspace-virtual-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: rowHeight,
                transform: `translateY(${item.start - scrollMargin}px)`,
              }}
            >
              <TagFlatRowView
                row={row}
                selectedTagPath={selectedTagPath}
                activePath={activePath}
                dropTag={dropTag}
                hideSubtagNotes={hideSubtagNotes}
                showNoteTitles={showNoteTitles}
                titlesByPath={titlesByPath}
                onToggle={toggleTagExpanded}
                onSelect={setSelectedTagPath}
                onOpenNote={onOpenNote}
                onHideSubtags={setHideSubtagNotes}
                onContextMenu={setMenu}
              />
            </div>
          );
        })}
      </TagListHost>
      {menu
        ? createPortal(
            <div
              className="tree-context-menu is-plaintext"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="tree-context-item"
                onClick={() => {
                  setRenamePath(menu.path);
                  setMenu(null);
                }}
              >
                Rename tag
              </button>
              <button
                type="button"
                className="tree-context-item is-danger"
                onClick={() => {
                  setDeletePath(menu.path);
                  setMenu(null);
                }}
              >
                Delete tag
              </button>
            </div>,
            document.body,
          )
        : null}
      <PromptDialog
        open={renamePath != null}
        title="Rename tag"
        description="Renames this tag and every nested tag. Notes stay where they are."
        label="Tag"
        defaultValue={renamePath ?? ""}
        confirmLabel="Rename"
        onCancel={() => setRenamePath(null)}
        onConfirm={(value) => {
          const from = renamePath;
          setRenamePath(null);
          if (!from) return;
          const next = sanitizeTagName(value);
          if (!next) {
            useVaultStore.setState({ error: "Invalid tag" });
            return;
          }
          if (next === from) return;
          void applyPrefix(from, next);
        }}
      />
      <ConfirmDialog
        open={deletePath != null}
        title="Delete tag"
        description="Removes this tag and nested tags from notes. The notes themselves stay in the vault."
        confirmLabel="Delete tag"
        onCancel={() => setDeletePath(null)}
        onConfirm={() => {
          const from = deletePath;
          setDeletePath(null);
          if (!from) return;
          void applyPrefix(from, null);
        }}
      />
      <TagFileColumn
        notes={noteTags}
        documentPaths={documentPaths}
        selectedTagPath={selectedTagPath}
        hideSubtagNotes={hideSubtagNotes}
        showNoteTitles={showNoteTitles}
        titlesByPath={titlesByPath}
        activePath={activePath}
        rowHeight={rowHeight}
        onOpenNote={onOpenNote}
        onHideSubtags={setHideSubtagNotes}
      />
    </DndContext>
  );
});

function TagListHost({
  listRef,
  height,
  children,
}: {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  height: number;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: TAG_LIST_ID });
  return (
    <div
      ref={(node) => {
        listRef.current = node;
        setNodeRef(node);
      }}
      className="workspace-virtual-tree"
      style={{ height, width: "100%", position: "relative" }}
    >
      {children}
    </div>
  );
}

const TagFlatRowView = memo(function TagFlatRowView({
  row,
  selectedTagPath,
  activePath,
  dropTag,
  hideSubtagNotes,
  showNoteTitles,
  titlesByPath,
  onToggle,
  onSelect,
  onOpenNote,
  onHideSubtags,
  onContextMenu,
}: {
  row: TagFlatRow;
  selectedTagPath: string | null;
  activePath: string | null;
  dropTag: string | null;
  hideSubtagNotes: boolean;
  showNoteTitles: boolean;
  titlesByPath?: Readonly<Record<string, string>>;
  onToggle: (path: string) => void;
  onSelect: (path: string | null) => void;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  onHideSubtags: (hide: boolean) => void;
  onContextMenu: (menu: { x: number; y: number; path: string }) => void;
}) {
  if (row.kind === "divider") {
    return <div className="tag-tree-divider" />;
  }
  if (row.kind === "listHeader") {
    const exact = selectedTagPath != null && selectedTagPath !== UNTAGGED_SELECTION;
    return (
      <div className="tree-row tag-tree-list-header" style={rowPad(1)}>
        <span className="tree-chevron-btn is-empty" aria-hidden />
        <span className="tag-tree-list-label">Notes</span>
        {exact ? (
          <button
            type="button"
            className={
              hideSubtagNotes
                ? "tag-tree-hide-subtags is-active"
                : "tag-tree-hide-subtags"
            }
            aria-pressed={hideSubtagNotes}
            onClick={(e) => {
              e.stopPropagation();
              onHideSubtags(!hideSubtagNotes);
            }}
          >
            Hide subtag notes
          </button>
        ) : null}
      </div>
    );
  }
  if (row.kind === "empty") {
    return (
      <div className="tree-row tag-tree-empty" style={rowPad(2)}>
        <span className="tree-chevron-btn is-empty" aria-hidden />
        <span className="tree-node-label">No notes</span>
      </div>
    );
  }
  if (row.kind === "untagged") {
    const selected = selectedTagPath === UNTAGGED_SELECTION;
    return (
      <div
        className={
          selected
            ? "tree-row tree-folder-row is-selected"
            : "tree-row tree-folder-row"
        }
        style={rowPad(1)}
        onClick={() => onSelect(UNTAGGED_SELECTION)}
      >
        <span className="tree-chevron-btn is-empty" aria-hidden />
        <span className="tree-node-icon" aria-hidden>
          <TagIcon />
        </span>
        <span className="tree-node-label is-italic">Untagged</span>
      </div>
    );
  }
  if (row.kind === "tag") {
    const selected =
      selectedTagPath != null &&
      selectedTagPath.toLowerCase() === row.path.toLowerCase();
    const drop = dropTag != null && dropTag.toLowerCase() === row.path.toLowerCase();
    return (
      <div
        className={[
          "tree-row",
          "tree-folder-row",
          selected ? "is-selected" : "",
          drop ? "is-drop-target" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={rowPad(row.depth)}
        title={row.path}
        onClick={() => onSelect(row.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu({ x: e.clientX, y: e.clientY, path: row.path });
        }}
      >
        <span
          role={row.hasChildren ? "button" : undefined}
          tabIndex={row.hasChildren ? 0 : undefined}
          className={
            row.hasChildren ? "tree-chevron-btn" : "tree-chevron-btn is-empty"
          }
          aria-hidden={row.hasChildren ? undefined : true}
          aria-expanded={row.hasChildren ? row.open : undefined}
          aria-label={
            row.hasChildren ? (row.open ? "Collapse" : "Expand") : undefined
          }
          onClick={
            row.hasChildren
              ? (e) => {
                  e.stopPropagation();
                  onToggle(row.path);
                }
              : undefined
          }
        >
          {row.hasChildren ? <ChevronIcon open={row.open} /> : null}
        </span>
        <span className="tree-node-icon" aria-hidden>
          <TagIcon />
        </span>
        <span className="tree-node-label">{row.name}</span>
      </div>
    );
  }
  return (
    <TagNoteRow
      path={row.path}
      active={activePath === row.path}
      showNoteTitles={showNoteTitles}
      titlesByPath={titlesByPath}
      onOpenNote={onOpenNote}
    />
  );
});

function TagNoteRow({
  path,
  active,
  showNoteTitles,
  titlesByPath,
  onOpenNote,
  depth = 0,
  flush = false,
}: {
  path: string;
  active: boolean;
  showNoteTitles: boolean;
  titlesByPath?: Readonly<Record<string, string>>;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  depth?: number;
  flush?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tag-doc:${path}`,
    data: { path },
  });
  const pdf = path.toLowerCase().endsWith(".pdf");
  const title = showNoteTitles ? titlesByPath?.[path] : undefined;
  const label = title?.trim() || noteLabel(path);
  const open = (event: ReactMouseEvent) => {
    void onOpenNote(path, { preview: !(event.ctrlKey || event.metaKey) });
  };
  return (
    <div
      ref={setNodeRef}
      className={
        active
          ? "tree-row tree-file is-selected"
          : isDragging
            ? "tree-row tree-file is-dragging"
            : "tree-row tree-file"
      }
      style={
        flush
          ? { paddingLeft: 0, paddingRight: "var(--tree-pad-x)" }
          : rowPad(depth)
      }
      {...attributes}
      {...listeners}
      onClick={open}
      onDoubleClick={() => onOpenNote(path, { preview: false })}
    >
      {flush ? null : <span className="tree-chevron-btn is-empty" aria-hidden />}
      <span className="tree-node-icon" aria-hidden>
        {pdf ? (
          <span className="tree-pdf-icon">
            <PdfIcon />
          </span>
        ) : (
          <FcDocument size={20} />
        )}
      </span>
      <span className="tree-node-label">{label}</span>
    </div>
  );
}

function TagFileColumn({
  notes,
  documentPaths,
  selectedTagPath,
  hideSubtagNotes,
  showNoteTitles,
  titlesByPath,
  activePath,
  rowHeight,
  onOpenNote,
  onHideSubtags,
}: {
  notes: NoteTags[];
  documentPaths: string[];
  selectedTagPath: string | null;
  hideSubtagNotes: boolean;
  showNoteTitles: boolean;
  titlesByPath?: Readonly<Record<string, string>>;
  activePath: string | null;
  rowHeight: number;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  onHideSubtags: (hide: boolean) => void;
}) {
  const slot = useTagFileSlot();
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const docs = useMemo(
    () =>
      documentsForSelection(
        notes,
        documentPaths,
        selectedTagPath,
        hideSubtagNotes,
      ),
    [notes, documentPaths, selectedTagPath, hideSubtagNotes],
  );
  const virtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    getItemKey: (index) => docs[index] ?? index,
  });

  if (!slot || selectedTagPath == null) return null;

  const exact = selectedTagPath !== UNTAGGED_SELECTION;
  const title = exact ? selectedTagPath : "Untagged";
  const items = virtualizer.getVirtualItems();

  return createPortal(
    <div className="tag-file-column">
      <div className="tag-file-column-header">
        {exact ? (
          <span className="tree-node-icon" aria-hidden>
            <TagIcon />
          </span>
        ) : null}
        <span className="tag-file-column-title" title={title}>
          {title}
        </span>
        {exact ? (
          <button
            type="button"
            className={
              hideSubtagNotes
                ? "tree-toolbar-btn is-open"
                : "tree-toolbar-btn"
            }
            title={hideSubtagNotes ? "Show subtag notes" : "Hide subtag notes"}
            aria-label={hideSubtagNotes ? "Show subtag notes" : "Hide subtag notes"}
            aria-pressed={hideSubtagNotes}
            onClick={() => onHideSubtags(!hideSubtagNotes)}
          >
            <EyeIcon off={hideSubtagNotes} />
          </button>
        ) : null}
      </div>
      <div
        className="tag-file-column-scroll"
        ref={setScrollEl}
      >
        {docs.length === 0 ? (
          <div className="tag-tree-empty">No notes</div>
        ) : (
          <div
            className="tag-file-column-list"
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {items.map((item) => {
              const path = docs[item.index];
              if (!path) return null;
              return (
                <div
                  key={path}
                  className="workspace-virtual-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: rowHeight,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TagNoteRow
                    path={path}
                    active={activePath === path}
                    showNoteTitles={showNoteTitles}
                    titlesByPath={titlesByPath}
                    onOpenNote={onOpenNote}
                    flush
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    slot,
  );
}

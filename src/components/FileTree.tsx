import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  Tree,
  type NodeModel,
  type DropOptions,
  type TreeMethods,
} from "@minoru/react-dnd-treeview";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { TreeNode } from "../lib/vaultApi";
import {
  absolutePath,
  getProjectProperties,
  isSkillsFolder,
  isVaultProjectFolder,
  parentPath,
  setProjectProperties,
  type ProjectProperties,
} from "../lib/vaultApi";
import { saveExpandedPaths } from "../lib/settingsStore";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import {
  PromptDialog,
  ConfirmDialog,
  ProjectPropertiesDialog,
} from "./AppDialog";
import {
  FcDocument,
  FcFolder,
  FcOpenedFolder,
  FcPackage,
  FcSafe,
  FcWorkflow,
} from "react-icons/fc";
import {
  beginDrawioTreeDrag,
  DRAWIO_TREE_MIME,
  endDrawioTreeDrag,
} from "../editor/drawio/treeDrag";
import {
  beginVaultTreeDrag,
  endVaultTreeDrag,
  VAULT_TREE_MIME,
} from "../lib/vaultTreeDrag";
import {
  clipboardHasOsFiles,
  collectVaultDocumentFiles,
  pathsFromClipboardData,
} from "../lib/osClipboardFiles";
import {
  CollectionPlusIcon,
  DiagramIcon,
  LinksIcon,
  PlusIcon,
} from "./treeIcons";
import type { TreeCreateKind } from "./TreeToolbar";

const TREE_ROOT = "__tree_root__";
const VAULT_ID = "__vault__";

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Select basename stem (before last extension) for rename, like VS Code. */
function selectRenameStem(input: HTMLInputElement, name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot > 0) {
    input.setSelectionRange(0, lastDot);
  } else {
    input.select();
  }
}

/** Keeps module-level drawio drag path in sync with react-dnd isDragging. */
function DrawioTreeDragBridge({
  active,
  path,
}: {
  active: boolean;
  path: string;
}) {
  useEffect(() => {
    if (!active) return;
    beginDrawioTreeDrag(path);
    return () => endDrawioTreeDrag();
  }, [active, path]);
  return null;
}

type NodeData = {
  path: string;
  isDir: boolean;
  hasChildren: boolean;
};

export type PromptKind = TreeCreateKind | "skill";

function FolderTreeIcon({
  path,
  isOpen,
  size = 20,
}: {
  path: string;
  isOpen: boolean;
  size?: number;
}) {
  if (isSkillsFolder(path)) return <FcWorkflow size={size} />;
  if (isVaultProjectFolder(path, true)) return <FcPackage size={size} />;
  return isOpen ? <FcOpenedFolder size={size} /> : <FcFolder size={size} />;
}

type ContextMenuState = {
  x: number;
  y: number;
  path: string;
  name: string;
  isDir: boolean;
  /** Empty sidebar / background — create only, no rename/delete. */
  createOnly?: boolean;
  /** Already in favorites — show remove instead of add. */
  isFavorite?: boolean;
};

export type FileTreeHandle = {
  openCreateMenu: (x: number, y: number) => void;
  startCreate: (kind: PromptKind) => void;
  revealActive: () => void;
};

type DeleteTarget = {
  path: string;
  name: string;
  isDir: boolean;
};

function toStorePath(id: string | number): string {
  const s = String(id);
  return s === VAULT_ID ? "" : s;
}

function toNodeId(path: string): string {
  return path === "" ? VAULT_ID : path;
}

/** Ancestor folder paths for a vault-relative file path (excludes the file itself). */
function ancestorFolderPaths(filePath: string): string[] {
  const cleaned = filePath.replace(/^\/+|\/+$/g, "");
  if (!cleaned.includes("/")) return [];
  const parts = cleaned.split("/");
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join("/"));
  }
  return out;
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

function flattenTree(root: TreeNode): NodeModel<NodeData>[] {
  const nodes: NodeModel<NodeData>[] = [];

  const walk = (node: TreeNode, parentId: string) => {
    const id = toNodeId(node.path);
    const children = node.children ?? [];
    nodes.push({
      id,
      parent: parentId,
      text: node.name,
      droppable: node.isDir,
      data: {
        path: node.path,
        isDir: node.isDir,
        hasChildren: node.isDir && children.length > 0,
      },
    });
    if (node.isDir) {
      for (const child of children) {
        walk(child, id);
      }
    }
  };

  walk(root, TREE_ROOT);
  return nodes;
}

function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.5 3.25 12.75 6.5 6 13.25H2.75V10l6.75-6.75Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M8.25 4.5 11.5 7.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PropertiesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.75"
        y="2.75"
        width="10.5"
        height="10.5"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5 5.75h6M5 8h6M5 10.25h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 4.5h9M6.25 4.5V3.25h3.5V4.5M5 4.5l.5 8.25h5L11 4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RevealIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.25V12a1.25 1.25 0 0 0 1.25 1.25h8.5A1.25 1.25 0 0 0 13.5 12V5.75"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M2.5 5.5 4.1 3.4A1 1 0 0 1 4.9 3h2.35l1.1 1.5H13a.75.75 0 0 1 .75.75V5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.25 8.25 11.5 10.5 9.25 12.75M11.25 10.5H6.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyPathIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="5.25"
        y="5.25"
        width="7.5"
        height="7.5"
        rx="1.25"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M3.5 10.5V3.75A1.25 1.25 0 0 1 4.75 2.5H10.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.4 9.7 5.9l3.8.4-2.9 2.6.9 3.7L8 10.7l-3.5 2 0.9-3.7-2.9-2.6 3.8-.4L8 2.4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

function findTreeNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null;
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const hit = findTreeNode(child, path);
    if (hit) return hit;
  }
  return null;
}

/** Split basename into stem + extension (same rules as rename selection). */
function splitFileName(name: string): { stem: string; ext: string } | null {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return null;
  return { stem: name.slice(0, lastDot), ext: name.slice(lastDot) };
}

function TreeNodeLabel({ text, isDir }: { text: string; isDir?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [title, setTitle] = useState<string | undefined>();
  const parts = !isDir ? splitFileName(text) : null;

  return (
    <span
      ref={ref}
      className="tree-node-label"
      title={title}
      onMouseEnter={() => {
        const el = ref.current;
        if (!el) return;
        setTitle(el.scrollWidth > el.clientWidth + 1 ? text : undefined);
      }}
      onMouseLeave={() => setTitle(undefined)}
    >
      {parts ? (
        <>
          {parts.stem}
          <span className="tree-node-ext">{parts.ext}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

async function revealPathInExplorer(relPath: string) {
  const abs = await absolutePath(relPath);
  await revealItemInDir(abs);
}

async function copyAbsolutePath(relPath: string) {
  const abs = await absolutePath(relPath);
  await writeText(abs);
}

function TreeContextMenu({
  menu,
  onClose,
  onNewNote,
  onNewDiagram,
  onNewLinks,
  onNewFolder,
  onNewSkill,
  onRename,
  onDelete,
  onReveal,
  onCopyPath,
  onCopyAbsolutePath,
  onToggleFavorite,
  onProjectProperties,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewNote: () => void;
  onNewDiagram: () => void;
  onNewLinks: () => void;
  onNewFolder: () => void;
  onNewSkill: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onCopyAbsolutePath: () => void;
  onToggleFavorite: () => void;
  onProjectProperties: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isSkills = isSkillsFolder(menu.path, menu.isDir);
  const showEditActions = !menu.createOnly && menu.path !== "" && !isSkills;
  const showCopyPath = !menu.createOnly && menu.path !== "";
  const showFavorite = !menu.createOnly && menu.path !== "";
  const showProjectProperties =
    !menu.createOnly && isVaultProjectFolder(menu.path, menu.isDir);
  const showSkillCreate = isSkills || menu.createOnly === true;
  const showStandardCreate = !isSkills;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 280);
  const top = Math.min(menu.y, window.innerHeight - 400);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {showFavorite ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onToggleFavorite();
            }}
          >
            <StarIcon filled={menu.isFavorite} />
            <span>
              {menu.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </span>
          </button>
          <div className="tree-context-sep" role="separator" />
        </>
      ) : null}
      {showProjectProperties ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onProjectProperties();
            }}
          >
            <PropertiesIcon />
            <span>Project properties…</span>
          </button>
          <div className="tree-context-sep" role="separator" />
        </>
      ) : null}
      {showSkillCreate ? (
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          onClick={() => {
            onClose();
            onNewSkill();
          }}
        >
          <PlusIcon />
          <span>New skill…</span>
        </button>
      ) : null}
      {showStandardCreate ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onNewNote();
            }}
          >
            <PlusIcon />
            <span>New note</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onNewDiagram();
            }}
          >
            <DiagramIcon />
            <span>New diagram</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onNewLinks();
            }}
          >
            <LinksIcon />
            <span>New links</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onNewFolder();
            }}
          >
            <CollectionPlusIcon />
            <span>New folder</span>
          </button>
        </>
      ) : null}
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onReveal();
        }}
      >
        <RevealIcon />
        <span>Reveal in file manager</span>
      </button>
      {showCopyPath ? (
        <>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onCopyPath();
            }}
          >
            <CopyPathIcon />
            <span>Copy relative path</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onCopyAbsolutePath();
            }}
          >
            <CopyPathIcon />
            <span>Copy absolute path</span>
          </button>
        </>
      ) : null}
      {showEditActions ? (
        <>
          <div className="tree-context-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onRename();
            }}
          >
            <RenameIcon />
            <span>Rename</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-context-item is-danger"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <TrashIcon />
            <span>Delete</span>
          </button>
        </>
      ) : null}
    </div>,
    document.body,
  );
}

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const committed = useRef(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      selectRenameStem(input, initialValue);
    });
    return () => window.cancelAnimationFrame(id);
  }, [initialValue]);

  const finish = (action: () => void) => {
    if (committed.current) return;
    committed.current = true;
    // Blur before unmount so react-dnd-treeview releases its input drag-lock
    // (focusout often does not fire when a focused input is removed).
    inputRef.current?.blur();
    action();
  };

  const commit = () => {
    const next = value.trim();
    if (!next || next === initialValue) {
      finish(() => onCancel());
      return;
    }
    finish(() => onCommit(next));
  };

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(() => onCancel());
        }
      }}
      onBlur={commit}
    />
  );
}

function FavoritesTreeRows({
  nodes,
  depth,
  expandedPaths,
  activePath,
  selectedFolderPath,
  selectedFolderExplicit,
  treeSelectionVisible,
  renamingPath,
  favoriteSet,
  onOpenContextMenu,
  onSelectFolder,
  onOpenNote,
  onToggleExpanded,
  onRenameCommit,
  onRenameCancel,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedPaths: string[];
  activePath: string | null;
  selectedFolderPath: string;
  selectedFolderExplicit: boolean;
  treeSelectionVisible: boolean;
  renamingPath: string | null;
  favoriteSet: Set<string>;
  onOpenContextMenu: (menu: ContextMenuState) => void;
  onSelectFolder: (path: string) => void;
  onOpenNote: (path: string, options?: { preview?: boolean }) => void;
  onToggleExpanded: (path: string) => void;
  onRenameCommit: (path: string, nextName: string) => void;
  onRenameCancel: () => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const path = node.path;
        const isDir = node.isDir;
        const children = node.children ?? [];
        const hasChildren = isDir && children.length > 0;
        const isOpen = isDir && expandedPaths.includes(path);
        const isProject = isVaultProjectFolder(path, isDir);
        const isSkills = isSkillsFolder(path, isDir);
        const isDrawio = !isDir && path.toLowerCase().endsWith(".drawio");
        const isMdlnks = !isDir && path.toLowerCase().endsWith(".mdlnks");
        const selected =
          treeSelectionVisible &&
          isDir &&
          selectedFolderExplicit &&
          selectedFolderPath === path;
        const active =
          treeSelectionVisible &&
          !isDir &&
          !selectedFolderExplicit &&
          activePath === path;
        const renaming = renamingPath === path;

        return (
          <div key={`fav:${path}`} className="favorites-node">
            <div
              className={[
                "tree-row",
                isDir ? "tree-folder-row" : "tree-file",
                isProject ? "is-project" : "",
                isSkills ? "is-skills" : "",
                selected || active ? "is-selected" : "",
                renaming ? "is-renaming" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                paddingLeft: `calc(var(--tree-pad-x) + ${depth} * var(--tree-indent))`,
                paddingRight: "var(--tree-pad-x)",
              }}
              data-vault-path={path || undefined}
              data-vault-isdir={isDir && path ? "1" : undefined}
              data-drawio-path={isDrawio ? path : undefined}
              onClick={() => {
                if (renaming) return;
                if (isDir) {
                  onSelectFolder(path);
                  if (hasChildren) onToggleExpanded(path);
                  return;
                }
                onOpenNote(path, { preview: true });
              }}
              onDoubleClick={() => {
                if (isDir || renaming) return;
                onOpenNote(path, { preview: false });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  path,
                  name: node.name,
                  isDir,
                  isFavorite: favoriteSet.has(path),
                });
                if (isDir) onSelectFolder(path);
                else onOpenNote(path, { preview: true });
              }}
            >
              {isDir ? (
                <span
                  role={hasChildren ? "button" : undefined}
                  tabIndex={hasChildren ? 0 : undefined}
                  className={
                    hasChildren
                      ? "tree-chevron-btn"
                      : "tree-chevron-btn is-empty"
                  }
                  aria-hidden={hasChildren ? undefined : true}
                  aria-label={
                    hasChildren
                      ? isOpen
                        ? "Collapse"
                        : "Expand"
                      : undefined
                  }
                  aria-expanded={hasChildren ? isOpen : undefined}
                  onClick={
                    hasChildren
                      ? (e) => {
                          e.stopPropagation();
                          onToggleExpanded(path);
                        }
                      : undefined
                  }
                  onKeyDown={
                    hasChildren
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleExpanded(path);
                          }
                        }
                      : undefined
                  }
                >
                  <ChevronIcon open={isOpen} />
                </span>
              ) : (
                <span className="tree-file-spacer" />
              )}

              <span className="tree-node-icon" aria-hidden>
                {isDir ? (
                  <FolderTreeIcon path={path} isOpen={isOpen} />
                ) : isDrawio ? (
                  <span className="tree-drawio-icon">
                    <DiagramIcon />
                  </span>
                ) : isMdlnks ? (
                  <span className="tree-mdlnks-icon">
                    <LinksIcon />
                  </span>
                ) : (
                  <FcDocument size={20} />
                )}
              </span>

              {renaming ? (
                <InlineRenameInput
                  key={path}
                  initialValue={node.name}
                  onCancel={onRenameCancel}
                  onCommit={(nextName) => onRenameCommit(path, nextName)}
                />
              ) : (
                <TreeNodeLabel text={node.name} isDir={isDir} />
              )}
            </div>

            {isDir && isOpen && hasChildren ? (
              <FavoritesTreeRows
                nodes={children}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                activePath={activePath}
                selectedFolderPath={selectedFolderPath}
                selectedFolderExplicit={selectedFolderExplicit}
                treeSelectionVisible={treeSelectionVisible}
                renamingPath={renamingPath}
                favoriteSet={favoriteSet}
                onOpenContextMenu={onOpenContextMenu}
                onSelectFolder={onSelectFolder}
                onOpenNote={onOpenNote}
                onToggleExpanded={onToggleExpanded}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export const FileTree = forwardRef<FileTreeHandle>(function FileTree(_props, ref) {
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const treeRevealRequest = useSidebarUiStore((s) => s.treeRevealRequest);
  const favoritePaths = useVaultStore((s) => s.favoritePaths);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const selectedFolderExplicit = useVaultStore((s) => s.selectedFolderExplicit);
  const treeSelectionVisible = useVaultStore((s) => s.treeSelectionVisible);
  const createNoteInSelection = useVaultStore((s) => s.createNoteInSelection);
  const createDrawioInSelection = useVaultStore((s) => s.createDrawioInSelection);
  const createMdlnksInSelection = useVaultStore((s) => s.createMdlnksInSelection);
  const createFolderInSelection = useVaultStore((s) => s.createFolderInSelection);
  const createSkill = useVaultStore((s) => s.createSkill);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const importIntoSelection = useVaultStore((s) => s.importIntoSelection);
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const openNote = useVaultStore((s) => s.openNote);
  const toggleExpanded = useVaultStore((s) => s.toggleExpanded);
  const addToFavorites = useVaultStore((s) => s.addToFavorites);
  const removeFromFavorites = useVaultStore((s) => s.removeFromFavorites);

  const treeRef = useRef<TreeMethods>(null);
  const treeFocusRef = useRef<HTMLDivElement | null>(null);
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);
  const [promptKind, setPromptKind] = useState<PromptKind | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [projectPropsTarget, setProjectPropsTarget] =
    useState<ProjectProperties | null>(null);
  const [projectPropsLoading, setProjectPropsLoading] = useState(false);
  const [projectPropsSaving, setProjectPropsSaving] = useState(false);

  const openProjectProperties = useCallback(async (path: string) => {
    setProjectPropsLoading(true);
    try {
      const props = await getProjectProperties(path);
      setProjectPropsTarget(props);
    } catch (err) {
      console.error("Failed to load project properties", err);
      setProjectPropsTarget({ path, about: "" });
    } finally {
      setProjectPropsLoading(false);
    }
  }, []);

  const saveProjectProperties = useCallback(
    async (about: string) => {
      if (!projectPropsTarget) return;
      setProjectPropsSaving(true);
      try {
        await setProjectProperties(projectPropsTarget.path, about);
        setProjectPropsTarget(null);
      } catch (err) {
        console.error("Failed to save project properties", err);
      } finally {
        setProjectPropsSaving(false);
      }
    },
    [projectPropsTarget],
  );

  const setTreeScrollRef = useCallback((node: HTMLDivElement | null) => {
    treeFocusRef.current = node;
    setDndRoot(node);
  }, []);

  /** Expand every folder on the way to `path` (plus itself for folders) and scroll to it. */
  const revealPathInTree = useCallback(
    (path: string, options?: { isDir?: boolean }) => {
      if (!path) return;
      const { vaultPath: vp, expandedPaths } = useVaultStore.getState();
      const toOpen = ancestorFolderPaths(path);
      if (options?.isDir) toOpen.push(path);

      const missing = toOpen.filter((a) => !expandedPaths.includes(a));
      if (missing.length > 0) {
        const next = [...expandedPaths, ...missing];
        useVaultStore.setState({ expandedPaths: next });
        if (vp) void saveExpandedPaths(vp, next);
      }

      treeRef.current?.open(VAULT_ID);
      for (const a of toOpen) {
        treeRef.current?.open(toNodeId(a));
      }

      let attempts = 0;
      const scrollToRow = () => {
        const root = treeFocusRef.current;
        if (!root) return;
        const el = root.querySelector(
          `[data-vault-path="${CSS.escape(path)}"]`,
        ) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return;
        }
        if (attempts++ < 12) requestAnimationFrame(scrollToRow);
      };
      requestAnimationFrame(scrollToRow);
    },
    [],
  );

  const revealActiveInTree = useCallback(() => {
    const path = useVaultStore.getState().activePath;
    if (!path) return;
    useVaultStore.setState({
      selectedFolderExplicit: false,
      selectedFolderPath: parentPath(path),
      treeSelectionVisible: true,
    });
    revealPathInTree(path);
  }, [revealPathInTree]);

  useEffect(() => {
    if (!treeRevealRequest) return;
    useVaultStore.setState({
      selectedFolderExplicit: false,
      selectedFolderPath: parentPath(treeRevealRequest.path),
      treeSelectionVisible: true,
    });
    revealPathInTree(treeRevealRequest.path);
  }, [revealPathInTree, treeRevealRequest]);

  useImperativeHandle(ref, () => ({
    openCreateMenu: (x, y) => {
      if (!useVaultStore.getState().vaultPath) return;
      setContextMenu({
        x,
        y,
        path: useVaultStore.getState().selectedFolderPath,
        name: "",
        isDir: true,
        createOnly: true,
      });
    },
    startCreate: (kind) => setPromptKind(kind),
    revealActive: revealActiveInTree,
  }));

  // Scope HTML5Backend to the sidebar so it does not steal BlockNote block drag.
  // Prefer HTML5Backend alone: MultiBackend+TouchBackend breaks mouse DnD on
  // Windows WebView2 (especially with nested interactive controls).
  const backendOptions = useMemo(
    () => (dndRoot ? { rootElement: dndRoot } : null),
    [dndRoot],
  );

  // Mirror vault file drags into dataTransfer so panes outside the DnD root
  // (chat composer, note editor for .drawio) can accept native drops.
  useEffect(() => {
    if (!dndRoot) return;
    const onDragStart = (event: DragEvent) => {
      // dragstart target is the draggable <li>, not the inner row — look up and down.
      const target = event.target as HTMLElement | null;
      const el = (target?.closest?.("[data-vault-path]") ??
        target?.querySelector?.("[data-vault-path]")) as HTMLElement | null;
      const rawPath = el?.dataset.vaultPath;
      if (!rawPath || !event.dataTransfer) return;
      const isDir = el?.dataset.vaultIsdir === "1";
      const path =
        isDir && !rawPath.endsWith("/") ? `${rawPath}/` : rawPath;
      event.dataTransfer.setData(VAULT_TREE_MIME, path);
      event.dataTransfer.setData("text/plain", path);
      event.dataTransfer.effectAllowed = "copyMove";
      beginVaultTreeDrag(path);
      if (!isDir && path.toLowerCase().endsWith(".drawio")) {
        event.dataTransfer.setData(DRAWIO_TREE_MIME, path);
        beginDrawioTreeDrag(path);
      }
    };
    const onDragEnd = () => {
      endVaultTreeDrag();
      endDrawioTreeDrag();
    };

    dndRoot.addEventListener("dragstart", onDragStart, true);
    dndRoot.addEventListener("dragend", onDragEnd, true);
    return () => {
      dndRoot.removeEventListener("dragstart", onDragStart, true);
      dndRoot.removeEventListener("dragend", onDragEnd, true);
    };
  }, [dndRoot]);

  // F2 rename when the tree (or a row inside it) has focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F2") return;
      if (renamingPath || promptKind || deleteTarget) return;
      if (isEditableTarget(e.target)) return;
      const root = treeFocusRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (t && !root.contains(t) && t !== root) return;

      const {
        activePath,
        selectedFolderPath,
        selectedFolderExplicit,
      } = useVaultStore.getState();
      let target: string | null = null;
      if (selectedFolderExplicit && selectedFolderPath) {
        target = selectedFolderPath;
      } else if (activePath) {
        target = activePath;
      }
      if (!target || isSkillsFolder(target)) return;
      e.preventDefault();
      setContextMenu(null);
      setRenamingPath(target);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renamingPath, promptKind, deleteTarget]);

  const pasteOsFiles = (data: DataTransfer | null) => {
    if (!data || !clipboardHasOsFiles(data)) return false;
    const paths = pathsFromClipboardData(data);
    const files = paths.length ? [] : collectVaultDocumentFiles(data);
    if (!paths.length && !files.length) return false;
    void importIntoSelection(paths, files);
    return true;
  };

  const flatTree = useMemo(() => (tree ? flattenTree(tree) : []), [tree]);

  const favoriteSet = useMemo(() => new Set(favoritePaths), [favoritePaths]);

  const favoriteNodes = useMemo(() => {
    if (!tree) return [] as TreeNode[];
    const nodes: TreeNode[] = [];
    for (const path of favoritePaths) {
      const node = findTreeNode(tree, path);
      if (node) nodes.push(node);
    }
    return nodes;
  }, [tree, favoritePaths]);

  const initialOpen = useMemo(
    () => [VAULT_ID, ...expandedPaths.map(toNodeId)],
    // Only used on mount / vault change via key=
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultPath],
  );

  if (!tree || !vaultPath) return null;

  const handleDrop = (
    _newTree: NodeModel<NodeData>[],
    options: DropOptions<NodeData>,
  ) => {
    const { dragSourceId, dropTargetId, relativeIndex } = options;
    if (dragSourceId == null) return;
    if (dropTargetId === TREE_ROOT) return;

    const from = toStorePath(dragSourceId);
    const toParent = toStorePath(dropTargetId);
    if (!from) return;
    if (from === toParent || toParent.startsWith(`${from}/`)) return;

    void moveTreeEntry(from, toParent, relativeIndex ?? 0);
  };

  const submitCreate = (name: string) => {
    const kind = promptKind;
    setPromptKind(null);
    if (!kind) return;
    if (kind === "skill") {
      void createSkill(name).then(revealActiveInTree);
      return;
    }
    if (kind === "note") {
      void createNoteInSelection(name).then(revealActiveInTree);
      return;
    }
    if (kind === "drawio") {
      void createDrawioInSelection(name).then(revealActiveInTree);
      return;
    }
    if (kind === "mdlnks") {
      void createMdlnksInSelection(name).then(revealActiveInTree);
      return;
    }
    void createFolderInSelection(name).then(() => {
      revealPathInTree(useVaultStore.getState().selectedFolderPath, {
        isDir: true,
      });
    });
  };

  return (
    <div className="file-tree">
      <PromptDialog
        open={promptKind !== null}
        title={
          promptKind === "folder"
            ? "New folder"
            : promptKind === "drawio"
              ? "New diagram"
              : promptKind === "mdlnks"
                ? "New links"
                : promptKind === "skill"
                  ? "New skill"
                  : "New note"
        }
        description={
          promptKind === "folder"
            ? "Create a folder in the selected location."
            : promptKind === "drawio"
              ? "Create a Draw.io diagram in the selected location."
              : promptKind === "mdlnks"
                ? "Create a links collection in the selected location."
                : promptKind === "skill"
                  ? "Skill id: lowercase letters, digits, and hyphens (e.g. meeting-notes)."
                  : "Create a markdown note in the selected location."
        }
        label={promptKind === "skill" ? "Skill id" : "Name"}
        defaultValue={
          promptKind === "folder"
            ? "Folder"
            : promptKind === "drawio"
              ? "Diagram"
              : promptKind === "mdlnks"
                ? "Links"
                : promptKind === "skill"
                  ? "my-skill"
                  : "Untitled"
        }
        confirmLabel="Create"
        onCancel={() => setPromptKind(null)}
        onConfirm={submitCreate}
      />

      {contextMenu ? (
        <TreeContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onNewNote={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("note");
          }}
          onNewDiagram={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("drawio");
          }}
          onNewLinks={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("mdlnks");
          }}
          onNewFolder={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("folder");
          }}
          onNewSkill={() => {
            selectFolder("Skills");
            setPromptKind("skill");
          }}
          onRename={() => setRenamingPath(contextMenu.path)}
          onDelete={() =>
            setDeleteTarget({
              path: contextMenu.path,
              name: contextMenu.name,
              isDir: contextMenu.isDir,
            })
          }
          onReveal={() => {
            void revealPathInExplorer(contextMenu.path);
          }}
          onCopyPath={() => {
            void writeText(contextMenu.path);
          }}
          onCopyAbsolutePath={() => {
            void copyAbsolutePath(contextMenu.path);
          }}
          onToggleFavorite={() => {
            if (contextMenu.isFavorite) {
              void removeFromFavorites(contextMenu.path);
            } else {
              void addToFavorites(contextMenu.path);
            }
          }}
          onProjectProperties={() => {
            void openProjectProperties(contextMenu.path);
          }}
        />
      ) : null}

      <ProjectPropertiesDialog
        open={projectPropsTarget !== null && !projectPropsLoading}
        projectName={projectPropsTarget?.path ?? ""}
        about={projectPropsTarget?.about ?? ""}
        saving={projectPropsSaving}
        onCancel={() => {
          if (projectPropsSaving) return;
          setProjectPropsTarget(null);
        }}
        onSave={(about) => {
          void saveProjectProperties(about);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget?.isDir
            ? "Delete folder"
            : deleteTarget?.path.endsWith(".drawio")
              ? "Delete diagram"
              : deleteTarget?.path.endsWith(".mdlnks")
                ? "Delete links"
                : "Delete note"
        }
        description={
          deleteTarget?.isDir
            ? `Delete “${deleteTarget.name}” and all of its contents? This cannot be undone.`
            : `Delete “${deleteTarget?.name ?? ""}”? This cannot be undone.`
        }
        confirmLabel="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void removePath(target.path);
        }}
      />

      {/* Stable ref callback: an inline closure here re-runs on every render
          (detach with null → setDndRoot(null) → Tree unmounts → remounts with
          initialOpen), silently resetting expand/collapse state. */}
      <div
        className="tree-scroll"
        ref={setTreeScrollRef}
        tabIndex={0}
        onPaste={(e) => {
          if (pasteOsFiles(e.clipboardData)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {favoriteNodes.length > 0 ? (
          <div className="favorites-section">
            <div className="favorites-header">
              <StarIcon filled />
              <span>Favorites</span>
            </div>
            <FavoritesTreeRows
              nodes={favoriteNodes}
              depth={0}
              expandedPaths={expandedPaths}
              activePath={activePath}
              selectedFolderPath={selectedFolderPath}
              selectedFolderExplicit={selectedFolderExplicit}
              treeSelectionVisible={treeSelectionVisible}
              renamingPath={renamingPath}
              favoriteSet={favoriteSet}
              onOpenContextMenu={setContextMenu}
              onSelectFolder={selectFolder}
              onOpenNote={(path, options) => {
                void openNote(path, options);
              }}
              onToggleExpanded={toggleExpanded}
              onRenameCommit={(path, nextName) => {
                setRenamingPath(null);
                void renameTreeEntry(path, nextName);
              }}
              onRenameCancel={() => setRenamingPath(null)}
            />
          </div>
        ) : null}
        {backendOptions ? (
          <DndProvider backend={HTML5Backend} options={backendOptions}>
            <Tree
              ref={treeRef}
              key={vaultPath}
              tree={flatTree}
              rootId={TREE_ROOT}
              sort={false}
              insertDroppableFirst={false}
              dropTargetOffset={10}
              initialOpen={initialOpen}
              classes={{
                root: "dnd-tree-root",
                draggingSource: "dnd-dragging",
                dropTarget: "dnd-drop-target",
                placeholder: "dnd-placeholder",
              }}
              canDrag={(node) => {
                const path = node?.data?.path ?? "";
                if (node?.id === VAULT_ID) return false;
                if (path === renamingPath) return false;
                return true;
              }}
              canDrop={(_current, { dropTargetId, dragSourceId, dropTarget }) => {
                if (dragSourceId == null) return false;
                if (dropTargetId === TREE_ROOT) return false;

                const from = toStorePath(dragSourceId);
                const targetPath = toStorePath(dropTargetId);

                if (from === targetPath || targetPath.startsWith(`${from}/`)) {
                  return false;
                }

                // Skills stays at vault root: reorder among root siblings only.
                if (isSkillsFolder(from) && dropTargetId !== VAULT_ID) {
                  return false;
                }

                if (dropTargetId === VAULT_ID) return true;
                if (dropTarget?.droppable) return true;

                return false;
              }}
              onChangeOpen={(openIds) => {
                const next = openIds
                  .map(String)
                  .filter((id) => id !== VAULT_ID)
                  .map(toStorePath);
                useVaultStore.setState({ expandedPaths: next });
                void saveExpandedPaths(vaultPath, next);
              }}
              onDrop={handleDrop}
              dragPreviewRender={(monitor) => {
                const dragPath = String(monitor.item.data?.path ?? "");
                const isDir = Boolean(monitor.item.droppable);
                return (
                  <div className="dnd-preview">
                    <span className="dnd-preview-icon" aria-hidden>
                      {isDir ? (
                        <FolderTreeIcon path={dragPath} isOpen={false} size={16} />
                      ) : (
                        <FcDocument size={16} />
                      )}
                    </span>
                    <span className="dnd-preview-label">{monitor.item.text}</span>
                  </div>
                );
              }}
              placeholderRender={() => <div className="dnd-placeholder-line" />}
              render={(node, { depth, isOpen, onToggle, isDropTarget, isDragging }) => {
                const path = node.data?.path ?? toStorePath(node.id);
                const isDir = Boolean(node.droppable);
                const hasChildren = Boolean(node.data?.hasChildren);
                const isVault = node.id === VAULT_ID;
                const isProject = isVaultProjectFolder(path, isDir);
                const isSkills = isSkillsFolder(path, isDir);
                const isDrawio =
                  !isDir && path.toLowerCase().endsWith(".drawio");
                const isMdlnks =
                  !isDir && path.toLowerCase().endsWith(".mdlnks");
                const selected =
                  treeSelectionVisible &&
                  isDir &&
                  selectedFolderExplicit &&
                  selectedFolderPath === path;
                const active =
                  treeSelectionVisible &&
                  !isDir &&
                  !selectedFolderExplicit &&
                  activePath === path;
                const renaming = renamingPath === path;

                // No <button>/<a> inside the row: Chromium (WebView2) refuses to
                // start an HTML5 drag from form controls, which killed row drags
                // on Windows. Plain spans + a row-level click handler instead.
                const handleRowClick = () => {
                  treeFocusRef.current?.focus({ preventScroll: true });
                  if (renaming) return;
                  if (isDir) {
                    selectFolder(path);
                    if (!isVault && hasChildren) onToggle();
                    return;
                  }
                  void openNote(path, { preview: true });
                };

                return (
                  <div
                    className={[
                      "tree-row",
                      isDir ? "tree-folder-row" : "tree-file",
                      isVault ? "is-vault-root" : "",
                      isProject ? "is-project" : "",
                      isSkills ? "is-skills" : "",
                      selected || active ? "is-selected" : "",
                      isDropTarget ? "is-drop-target" : "",
                      isDragging ? "is-dragging" : "",
                      renaming ? "is-renaming" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      paddingLeft: `calc(var(--tree-pad-x) + ${depth} * var(--tree-indent))`,
                      paddingRight: "var(--tree-pad-x)",
                    }}
                    data-vault-path={path || undefined}
                    data-vault-isdir={isDir && path ? "1" : undefined}
                    data-drawio-path={isDrawio ? path : undefined}
                    onClick={handleRowClick}
                    onDoubleClick={() => {
                      if (isDir || renaming) return;
                      void openNote(path, { preview: false });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      treeFocusRef.current?.focus({ preventScroll: true });
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        path,
                        name: node.text,
                        isDir,
                        isFavorite: path !== "" && favoriteSet.has(path),
                      });
                      if (isDir) selectFolder(path);
                      else void openNote(path, { preview: true });
                    }}
                  >
                    <DrawioTreeDragBridge
                      active={isDragging && isDrawio}
                      path={path}
                    />
                    {isDir ? (
                      <span
                        role={hasChildren ? "button" : undefined}
                        tabIndex={hasChildren ? 0 : undefined}
                        className={
                          hasChildren
                            ? "tree-chevron-btn"
                            : "tree-chevron-btn is-empty"
                        }
                        aria-hidden={hasChildren ? undefined : true}
                        aria-label={
                          hasChildren
                            ? isOpen
                              ? "Collapse"
                              : "Expand"
                            : undefined
                        }
                        aria-expanded={hasChildren ? isOpen : undefined}
                        onClick={
                          hasChildren
                            ? (e) => {
                                e.stopPropagation();
                                onToggle();
                              }
                            : undefined
                        }
                        onKeyDown={
                          hasChildren
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onToggle();
                                }
                              }
                            : undefined
                        }
                      >
                        <ChevronIcon open={isOpen} />
                      </span>
                    ) : (
                      <span className="tree-file-spacer" />
                    )}

                    <span className="tree-node-icon" aria-hidden>
                      {isDir ? (
                        isVault ? (
                          <FcSafe size={20} />
                        ) : (
                          <FolderTreeIcon path={path} isOpen={isOpen} />
                        )
                      ) : isDrawio ? (
                        <span className="tree-drawio-icon">
                          <DiagramIcon />
                        </span>
                      ) : isMdlnks ? (
                        <span className="tree-mdlnks-icon">
                          <LinksIcon />
                        </span>
                      ) : (
                        <FcDocument size={20} />
                      )}
                    </span>

                    {renaming ? (
                      <InlineRenameInput
                        key={path}
                        initialValue={node.text}
                        onCancel={() => setRenamingPath(null)}
                        onCommit={(nextName) => {
                          setRenamingPath(null);
                          void renameTreeEntry(path, nextName);
                        }}
                      />
                    ) : (
                      <TreeNodeLabel text={node.text} isDir={isDir} />
                    )}
                  </div>
                );
              }}
            />
          </DndProvider>
        ) : null}
      </div>
    </div>
  );
});

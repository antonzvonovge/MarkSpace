import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DndProvider } from "react-dnd";
import {
  Tree,
  MultiBackend,
  getBackendOptions,
  type NodeModel,
  type DropOptions,
  type TreeMethods,
} from "@minoru/react-dnd-treeview";
import type { TreeNode } from "../lib/vaultApi";
import { saveExpandedPaths } from "../lib/settingsStore";
import { useVaultStore } from "../store/vaultStore";
import { PromptDialog, ConfirmDialog } from "./AppDialog";
import { FcDocument, FcFolder, FcOpenedFolder } from "react-icons/fc";

const TREE_ROOT = "__tree_root__";
const VAULT_ID = "__vault__";

type NodeData = {
  path: string;
  isDir: boolean;
};

type PromptKind = "note" | "folder";

type ContextMenuState = {
  x: number;
  y: number;
  path: string;
  name: string;
  isDir: boolean;
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

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
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

function CollectionPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="4.5"
        width="8"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M6.5 2.5h5.5A1.5 1.5 0 0 1 13.5 4v5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M6.5 7.5v3M5 9h3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function flattenTree(root: TreeNode): NodeModel<NodeData>[] {
  const nodes: NodeModel<NodeData>[] = [];

  const walk = (node: TreeNode, parentId: string) => {
    const id = toNodeId(node.path);
    nodes.push({
      id,
      parent: parentId,
      text: node.isDir ? node.name : node.name.replace(/\.md$/i, ""),
      droppable: node.isDir,
      data: { path: node.path, isDir: node.isDir },
    });
    if (node.isDir) {
      for (const child of node.children ?? []) {
        walk(child, id);
      }
    }
  };

  walk(root, TREE_ROOT);
  return nodes;
}

function TreeCreateMenu({
  onNewNote,
  onNewFolder,
}: {
  onNewNote: () => void;
  onNewFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="tree-create" ref={rootRef}>
      <button
        type="button"
        className={open ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"}
        title="Create"
        aria-label="Create"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon />
      </button>

      {open && (
        <div className="tree-create-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => {
              setOpen(false);
              onNewNote();
            }}
          >
            <PlusIcon />
            <span>New note</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => {
              setOpen(false);
              onNewFolder();
            }}
          >
            <CollectionPlusIcon />
            <span>New folder</span>
          </button>
        </div>
      )}
    </div>
  );
}

function TreeContextMenu({
  menu,
  onClose,
  onRename,
  onDelete,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

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

  const left = Math.min(menu.x, window.innerWidth - 180);
  const top = Math.min(menu.y, window.innerHeight - 90);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Переименовать
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
        Удалить
      </button>
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
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = value.trim();
    if (!next || next === initialValue) {
      onCancel();
      return;
    }
    onCommit(next);
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
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
    />
  );
}

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const selectedFolderExplicit = useVaultStore((s) => s.selectedFolderExplicit);
  const createNoteInSelection = useVaultStore((s) => s.createNoteInSelection);
  const createFolderInSelection = useVaultStore((s) => s.createFolderInSelection);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const openNote = useVaultStore((s) => s.openNote);

  const treeRef = useRef<TreeMethods>(null);
  const [promptKind, setPromptKind] = useState<PromptKind | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const flatTree = useMemo(() => (tree ? flattenTree(tree) : []), [tree]);

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
    const parent = selectedFolderPath;
    if (kind === "note") {
      void createNoteInSelection(name).then(() => {
        treeRef.current?.open(VAULT_ID);
        treeRef.current?.open(toNodeId(parent));
      });
      return;
    }
    void createFolderInSelection(name).then(() => {
      treeRef.current?.open(toNodeId(parent));
      treeRef.current?.open(VAULT_ID);
    });
  };

  return (
    <div className="file-tree">
      <PromptDialog
        open={promptKind !== null}
        title={promptKind === "folder" ? "New folder" : "New note"}
        description={
          promptKind === "folder"
            ? "Create a folder in the selected location."
            : "Create a markdown note in the selected location."
        }
        label="Name"
        defaultValue={promptKind === "folder" ? "Folder" : "Untitled"}
        confirmLabel="Create"
        onCancel={() => setPromptKind(null)}
        onConfirm={submitCreate}
      />

      {contextMenu ? (
        <TreeContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => setRenamingPath(contextMenu.path)}
          onDelete={() =>
            setDeleteTarget({
              path: contextMenu.path,
              name: contextMenu.name,
              isDir: contextMenu.isDir,
            })
          }
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.isDir ? "Удалить папку" : "Удалить заметку"}
        description={
          deleteTarget?.isDir
            ? `Удалить «${deleteTarget.name}» и всё её содержимое? Это действие нельзя отменить.`
            : `Удалить «${deleteTarget?.name ?? ""}»? Это действие нельзя отменить.`
        }
        confirmLabel="Удалить"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void removePath(target.path);
        }}
      />

      <div className="tree-scroll">
        <DndProvider backend={MultiBackend} options={getBackendOptions()}>
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
            canDrag={(node) =>
              node?.id !== VAULT_ID && node?.data?.path !== renamingPath
            }
            canDrop={(_current, { dropTargetId, dragSourceId, dropTarget }) => {
              if (dragSourceId == null) return false;
              if (dropTargetId === TREE_ROOT) return false;

              const from = toStorePath(dragSourceId);
              const targetPath = toStorePath(dropTargetId);

              if (from === targetPath || targetPath.startsWith(`${from}/`)) {
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
            dragPreviewRender={(monitor) => (
              <div className="dnd-preview">
                <span className="dnd-preview-icon" aria-hidden>
                  {monitor.item.droppable ? (
                    <FcFolder size={16} />
                  ) : (
                    <FcDocument size={16} />
                  )}
                </span>
                <span className="dnd-preview-label">{monitor.item.text}</span>
              </div>
            )}
            placeholderRender={() => <div className="dnd-placeholder-line" />}
            render={(node, { depth, isOpen, onToggle, isDropTarget, isDragging }) => {
              const path = node.data?.path ?? toStorePath(node.id);
              const isDir = Boolean(node.droppable);
              const isVault = node.id === VAULT_ID;
              const selected =
                isDir && selectedFolderExplicit && selectedFolderPath === path;
              const active =
                !isDir && !selectedFolderExplicit && activePath === path;
              const renaming = renamingPath === path;

              return (
                <div
                  className={[
                    "tree-row",
                    isDir ? "tree-folder-row" : "tree-file",
                    isVault ? "is-vault-root" : "",
                    selected || active ? "is-selected" : "",
                    isDropTarget ? "is-drop-target" : "",
                    isDragging ? "is-dragging" : "",
                    renaming ? "is-renaming" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ paddingLeft: 10 + depth * 14, paddingRight: 10 }}
                  onContextMenu={(e) => {
                    if (isVault) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      path,
                      name: node.text,
                      isDir,
                    });
                    if (isDir) selectFolder(path);
                    else void openNote(path, { preview: true });
                  }}
                >
                  {isDir ? (
                    <button
                      type="button"
                      className="tree-chevron-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle();
                      }}
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      <ChevronIcon open={isOpen} />
                    </button>
                  ) : (
                    <span className="tree-file-spacer" />
                  )}

                  <span className="tree-node-icon" aria-hidden>
                    {isDir ? (
                      isOpen ? (
                        <FcOpenedFolder size={20} />
                      ) : (
                        <FcFolder size={20} />
                      )
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
                    <button
                      type="button"
                      className={isDir ? "tree-folder-btn" : "tree-file-btn"}
                      onClick={() => {
                        if (isDir) selectFolder(path);
                        else void openNote(path, { preview: true });
                      }}
                      onDoubleClick={() => {
                        if (isDir) return;
                        void openNote(path, { preview: false });
                      }}
                    >
                      {node.text}
                    </button>
                  )}

                  {isVault ? (
                    <TreeCreateMenu
                      onNewNote={() => setPromptKind("note")}
                      onNewFolder={() => setPromptKind("folder")}
                    />
                  ) : null}
                </div>
              );
            }}
          />
        </DndProvider>
      </div>
    </div>
  );
}

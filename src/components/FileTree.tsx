import { useMemo, useRef } from "react";
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

const TREE_ROOT = "__tree_root__";
const VAULT_ID = "__vault__";

type NodeData = {
  path: string;
  isDir: boolean;
};

function toStorePath(id: string | number): string {
  const s = String(id);
  return s === VAULT_ID ? "" : s;
}

function toNodeId(path: string): string {
  return path === "" ? VAULT_ID : path;
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

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const createNoteInSelection = useVaultStore((s) => s.createNoteInSelection);
  const createFolderInSelection = useVaultStore((s) => s.createFolderInSelection);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const openNote = useVaultStore((s) => s.openNote);
  const removePath = useVaultStore((s) => s.removePath);

  const treeRef = useRef<TreeMethods>(null);

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

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            const name = prompt("New note name", "Untitled");
            if (!name) return;
            const parent = selectedFolderPath;
            void createNoteInSelection(name).then(() => {
              treeRef.current?.open(toNodeId(parent));
            });
          }}
        >
          + Note
        </button>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            const name = prompt("New folder name", "Folder");
            if (!name) return;
            const parent = selectedFolderPath;
            void createFolderInSelection(name).then(() => {
              treeRef.current?.open(toNodeId(parent));
              treeRef.current?.open(VAULT_ID);
            });
          }}
        >
          + Folder
        </button>
      </div>

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
            canDrag={(node) => node?.id !== VAULT_ID}
            canDrop={(_current, { dropTargetId, dragSourceId }) => {
              if (dropTargetId === TREE_ROOT) return false;
              if (dragSourceId == null) return false;
              const from = toStorePath(dragSourceId);
              const toParent = toStorePath(dropTargetId);
              if (from === toParent || toParent.startsWith(`${from}/`)) {
                return false;
              }
              return undefined;
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
              <div className="dnd-preview">{monitor.item.text}</div>
            )}
            placeholderRender={() => <div className="dnd-placeholder-line" />}
            render={(node, { depth, isOpen, onToggle, isDropTarget, isDragging }) => {
              const path = node.data?.path ?? toStorePath(node.id);
              const isDir = Boolean(node.droppable);
              const isVault = node.id === VAULT_ID;
              const selected = isDir && selectedFolderPath === path;
              const active = !isDir && activePath === path;

              return (
                <div
                  className={[
                    "tree-row",
                    isDir ? "tree-folder-row" : "tree-file",
                    isVault ? "is-vault-root" : "",
                    selected || active ? "is-selected" : "",
                    isDropTarget ? "is-drop-target" : "",
                    isDragging ? "is-dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ paddingLeft: 10 + depth * 14 }}
                >
                  {isDir ? (
                    <button
                      type="button"
                      className="tree-chevron-btn"
                      disabled={isVault}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isVault) onToggle();
                      }}
                      aria-label={isOpen ? "Collapse" : "Expand"}
                    >
                      <span className="tree-chevron">
                        {isOpen || isVault ? "▾" : "▸"}
                      </span>
                    </button>
                  ) : (
                    <span className="tree-file-spacer" />
                  )}

                  <span className={`arb-icon ${isDir ? "folder" : "file"}`} aria-hidden />

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

                  {!isVault && (
                    <button
                      type="button"
                      className="tree-delete"
                      title={isDir ? "Delete folder" : "Delete note"}
                      onClick={(e) => {
                        e.stopPropagation();
                        const msg = isDir
                          ? `Delete folder ${node.text} and its contents?`
                          : `Delete ${node.text}?`;
                        if (confirm(msg)) void removePath(path);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            }}
          />
        </DndProvider>
      </div>
    </div>
  );
}

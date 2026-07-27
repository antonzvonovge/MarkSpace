import { useState } from "react";
import type { TreeNode } from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";

function NoteRow({
  node,
  depth,
}: {
  node: TreeNode;
  depth: number;
}) {
  const activePath = useVaultStore((s) => s.activePath);
  const openNote = useVaultStore((s) => s.openNote);
  const removePath = useVaultStore((s) => s.removePath);
  const [open, setOpen] = useState(true);

  if (node.isDir) {
    return (
      <div className="tree-dir">
        <button
          type="button"
          className="tree-row tree-folder"
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="tree-chevron">{open ? "▾" : "▸"}</span>
          <span>{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <NoteRow key={child.path} node={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  const label = node.name.replace(/\.md$/i, "");
  const isActive = activePath === node.path;

  return (
    <div
      className={`tree-row tree-file ${isActive ? "is-active" : ""}`}
      style={{ paddingLeft: 10 + depth * 14 }}
    >
      <button type="button" className="tree-file-btn" onClick={() => void openNote(node.path)}>
        {label}
      </button>
      <button
        type="button"
        className="tree-delete"
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete ${label}?`)) void removePath(node.path);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const createAndOpenNote = useVaultStore((s) => s.createAndOpenNote);

  if (!tree) return null;

  return (
    <div className="file-tree">
      <div className="tree-toolbar">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            const name = prompt("New note name", "Untitled");
            if (!name) return;
            void createAndOpenNote(name);
          }}
        >
          + Note
        </button>
      </div>
      <div className="tree-scroll">
        {tree.children?.length ? (
          tree.children.map((child) => (
            <NoteRow key={child.path || child.name} node={child} depth={0} />
          ))
        ) : (
          <p className="tree-empty">No notes yet</p>
        )}
      </div>
    </div>
  );
}

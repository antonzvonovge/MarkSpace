import { useEffect, useMemo, useRef, useState } from "react";
import { FcFolder, FcOpenedFolder, FcPackage, FcPlanner } from "react-icons/fc";
import { MdChevronRight } from "react-icons/md";
import { DialogShell } from "./AppDialog";
import { LearningLanguageFlag } from "./LearningLanguageFlag";
import { learningLanguageFlagSvg } from "../lib/languageFlags";
import {
  findFolderInTree,
  folderPickerExpandedPaths,
} from "../lib/lastVaultFolder";
import {
  createFolder,
  isVaultProjectFolder,
  joinPath,
  type TreeNode,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";

type Props = {
  open: boolean;
  selectedPath: string;
  /** Limit the tree to this folder (e.g. a language project). */
  rootPath?: string;
  nested?: boolean;
  onCancel: () => void;
  onChoose: (folder: string) => void;
};

function FolderIcon({ node, open }: { node: TreeNode; open: boolean }) {
  const props = useVaultStore((s) => s.projectPropertiesByPath[node.path]);
  if (isVaultProjectFolder(node.path, true)) {
    if (props?.projectType === "languageLearning") {
      if (learningLanguageFlagSvg(props.learningLanguage)) {
        return (
          <LearningLanguageFlag
            language={props.learningLanguage}
            className="chat-project-flag"
          />
        );
      }
    }
    if (props?.projectType === "diary") return <FcPlanner size={16} />;
    return <FcPackage size={16} />;
  }
  return open ? <FcOpenedFolder size={16} /> : <FcFolder size={16} />;
}

function FolderRow({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelect,
  onConfirm,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onConfirm: (path: string) => void;
}) {
  const dirs = (node.children ?? []).filter((c) => c.isDir);
  const isOpen = expanded.has(node.path);
  const selected = selectedPath === node.path;
  return (
    <>
      <div
        className={`vault-folder-pick-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        data-folder-path={node.path}
      >
        {dirs.length > 0 ? (
          <button
            type="button"
            className={`vault-folder-pick-chevron${isOpen ? " is-open" : ""}`}
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
            }}
          >
            <MdChevronRight size={16} />
          </button>
        ) : (
          <span className="vault-folder-pick-chevron is-spacer" />
        )}
        <button
          type="button"
          className="vault-folder-pick-label"
          onClick={() => {
            onSelect(node.path);
            if (dirs.length > 0 && !isOpen) onToggle(node.path);
          }}
          onDoubleClick={() => onConfirm(node.path)}
        >
          <FolderIcon node={node} open={isOpen} />
          <span>{node.name}</span>
        </button>
      </div>
      {isOpen
        ? dirs.map((child) => (
            <FolderRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onConfirm={onConfirm}
            />
          ))
        : null}
    </>
  );
}

function safeFolderName(raw: string): string {
  return raw
    .trim()
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

export function VaultFolderBrowseDialog({
  open,
  selectedPath,
  rootPath,
  nested = false,
  onCancel,
  onChoose,
}: Props) {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const [draft, setDraft] = useState(selectedPath);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const scope = (rootPath ?? "").replace(/^\/+|\/+$/g, "");
  const roots = useMemo(() => {
    if (scope) {
      const node = findFolderInTree(tree, scope);
      return node ? [node] : [];
    }
    return (tree?.children ?? []).filter((c) => c.isDir);
  }, [tree, scope]);

  useEffect(() => {
    if (!open) return;
    const start = selectedPath.replace(/^\/+|\/+$/g, "") || scope;
    setDraft(start);
    setExpanded(new Set(folderPickerExpandedPaths(start || scope)));
    setCreating(false);
    setNewName("");
    setCreateError(null);
  }, [open, selectedPath, scope]);

  useEffect(() => {
    if (!open || !draft) return;
    const el = treeRef.current?.querySelector(
      `[data-folder-path="${CSS.escape(draft)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, draft, expanded, roots]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const createChild = async () => {
    const name = safeFolderName(newName);
    if (!name) {
      setCreateError("Enter a folder name.");
      return;
    }
    const parent = draft || scope;
    if (!parent) {
      setCreateError("Select a parent folder first.");
      return;
    }
    const path = joinPath(parent, name);
    try {
      await createFolder(path);
      await refreshTree();
      setDraft(path);
      setExpanded((prev) => new Set([...prev, parent, path]));
      setCreating(false);
      setNewName("");
      setCreateError(null);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <DialogShell
      open={open}
      nested={nested}
      wide
      title="Choose folder"
      description="Select a folder, or create one under the current selection."
      onCancel={onCancel}
      className="vault-folder-pick-dialog"
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!draft}
            onClick={() => onChoose(draft)}
          >
            Use folder
          </button>
        </>
      }
    >
      <div className="app-dialog-body vault-folder-pick-body">
      <div className="vault-folder-pick-current" title={draft}>
        {draft || "No folder selected"}
      </div>
      {roots.length === 0 ? (
        <p className="vault-folder-pick-empty">No folders in this vault.</p>
      ) : (
        <div className="vault-folder-pick-tree" ref={treeRef}>
          {roots.map((node) => (
            <FolderRow
              key={node.path}
              node={node}
              depth={0}
              selectedPath={draft}
              expanded={expanded}
              onToggle={toggle}
              onSelect={setDraft}
              onConfirm={onChoose}
            />
          ))}
        </div>
      )}
      <div className="vault-folder-pick-create">
        {creating ? (
          <>
            <input
              className="vault-folder-pick-create-input"
              value={newName}
              autoFocus
              placeholder="New folder name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createChild();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setCreating(false);
                }
              }}
            />
            <button
              type="button"
              className="app-dialog-btn is-primary"
              onClick={() => void createChild()}
            >
              Create
            </button>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => {
                setCreating(false);
                setCreateError(null);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="app-dialog-btn"
            disabled={!draft && !scope}
            onClick={() => {
              setCreating(true);
              setCreateError(null);
            }}
          >
            New folder
          </button>
        )}
      </div>
      {createError ? (
        <p className="vault-folder-pick-create-error">{createError}</p>
      ) : null}
      </div>
    </DialogShell>
  );
}

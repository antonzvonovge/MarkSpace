import { useEffect, useMemo, useState } from "react";
import { FcFolder, FcOpenedFolder, FcPackage, FcPlanner } from "react-icons/fc";
import { MdChevronRight } from "react-icons/md";
import { DialogShell } from "./AppDialog";
import { LearningLanguageFlag } from "./LearningLanguageFlag";
import { learningLanguageFlagSvg } from "../lib/languageFlags";
import { ancestorFolderPaths } from "../lib/lastVaultFolder";
import {
  isVaultProjectFolder,
  type TreeNode,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";

type Props = {
  open: boolean;
  selectedPath: string;
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
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const dirs = (node.children ?? []).filter((c) => c.isDir);
  const isOpen = expanded.has(node.path);
  const selected = selectedPath === node.path;
  return (
    <>
      <div
        className={`vault-folder-pick-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {dirs.length > 0 ? (
          <button
            type="button"
            className={`vault-folder-pick-chevron${isOpen ? " is-open" : ""}`}
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={() => onToggle(node.path)}
          >
            <MdChevronRight size={16} />
          </button>
        ) : (
          <span className="vault-folder-pick-chevron is-spacer" />
        )}
        <button
          type="button"
          className="vault-folder-pick-label"
          onClick={() => onSelect(node.path)}
          onDoubleClick={() => {
            onSelect(node.path);
            if (dirs.length > 0) onToggle(node.path);
          }}
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
            />
          ))
        : null}
    </>
  );
}

export function VaultFolderBrowseDialog({
  open,
  selectedPath,
  onCancel,
  onChoose,
}: Props) {
  const tree = useVaultStore((s) => s.tree);
  const [draft, setDraft] = useState(selectedPath);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const roots = useMemo(
    () => (tree?.children ?? []).filter((c) => c.isDir),
    [tree],
  );

  useEffect(() => {
    if (!open) return;
    setDraft(selectedPath);
    setExpanded(new Set(ancestorFolderPaths(selectedPath)));
  }, [open, selectedPath]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <DialogShell
      open={open}
      nested={false}
      title="Choose folder"
      description="Pick a folder in the vault."
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
      {roots.length === 0 ? (
        <p className="vault-folder-pick-empty">No folders in this vault.</p>
      ) : (
        <div className="vault-folder-pick-tree">
          {roots.map((node) => (
            <FolderRow
              key={node.path}
              node={node}
              depth={0}
              selectedPath={draft}
              expanded={expanded}
              onToggle={toggle}
              onSelect={setDraft}
            />
          ))}
        </div>
      )}
    </DialogShell>
  );
}

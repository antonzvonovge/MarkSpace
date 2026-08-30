import { useEffect, useMemo, useRef, useState } from "react";
import {
  FcClapperboard,
  FcDocument,
  FcFolder,
  FcOpenedFolder,
  FcPackage,
  FcPlanner,
} from "react-icons/fc";
import { MdChevronRight } from "react-icons/md";
import { folderPickerExpandedPaths } from "../lib/lastVaultFolder";
import { noteLabel } from "../lib/tagGraph";
import { learningLanguageFlagSvg } from "../lib/languageFlags";
import {
  documentKind,
  isFolderNotePath,
  isIncomingFolder,
  isTasksFolder,
  isVaultDocumentPath,
  isVaultProjectFolder,
  parentPath,
  type TreeNode,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import { DialogShell } from "./AppDialog";
import { LearningLanguageFlag } from "./LearningLanguageFlag";
import {
  CourseTrackerIcon,
  DiagramIcon,
  DictionaryIcon,
  HabitTrackerIcon,
  LinksIcon,
  PdfIcon,
} from "./treeIcons";

export type WikiLinkPickerResult = {
  target: string;
  label: string;
};

type Props = {
  open: boolean;
  /** Prefill for Link text (e.g. current editor selection). */
  initialLabel?: string;
  /** Expand tree toward this vault path (usually the active note). */
  revealPath?: string;
  nested?: boolean;
  onCancel: () => void;
  onConfirm: (result: WikiLinkPickerResult) => void;
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
    if (props?.projectType === "movies") return <FcClapperboard size={16} />;
    return <FcPackage size={16} />;
  }
  return open ? <FcOpenedFolder size={16} /> : <FcFolder size={16} />;
}

function FileIcon({ path }: { path: string }) {
  switch (documentKind(path)) {
    case "drawio":
      return <DiagramIcon size={16} />;
    case "mdlnks":
      return <LinksIcon size={16} />;
    case "mddict":
      return <DictionaryIcon size={16} />;
    case "mdhabit":
      return <HabitTrackerIcon size={16} />;
    case "mdcourse":
      return <CourseTrackerIcon size={16} />;
    case "pdf":
      return <PdfIcon />;
    default:
      return <FcDocument size={16} />;
  }
}

function isLinkableChild(node: TreeNode): boolean {
  if (isIncomingFolder(node.path, node.isDir)) return false;
  if (isTasksFolder(node.path, node.isDir)) return false;
  if (node.isDir) return true;
  if (isFolderNotePath(node.path)) return false;
  return isVaultDocumentPath(node.path);
}

function linkableChildren(node: TreeNode): TreeNode[] {
  return (node.children ?? []).filter(isLinkableChild);
}

function collectLinkable(
  node: TreeNode,
  out: { path: string; isDir: boolean; name: string }[] = [],
): { path: string; isDir: boolean; name: string }[] {
  for (const child of linkableChildren(node)) {
    out.push({ path: child.path, isDir: child.isDir, name: child.name });
    if (child.isDir) collectLinkable(child, out);
  }
  return out;
}

function defaultLabelFor(path: string, isDir: boolean): string {
  if (isDir) {
    const name = path.split("/").filter(Boolean).pop();
    return name || path;
  }
  return noteLabel(path);
}

function TreeRow({
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
  onSelect: (path: string, isDir: boolean) => void;
  onConfirm: (path: string, isDir: boolean) => void;
}) {
  const kids = linkableChildren(node);
  const hasKids = node.isDir && kids.length > 0;
  const isOpen = node.isDir && expanded.has(node.path);
  const selected = selectedPath === node.path;

  return (
    <>
      <div
        className={`vault-folder-pick-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        data-wiki-link-path={node.path}
      >
        {hasKids ? (
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
            onSelect(node.path, node.isDir);
            if (hasKids && !isOpen) onToggle(node.path);
          }}
          onDoubleClick={() => onConfirm(node.path, node.isDir)}
        >
          {node.isDir ? (
            <FolderIcon node={node} open={Boolean(isOpen)} />
          ) : (
            <FileIcon path={node.path} />
          )}
          <span>{node.name}</span>
        </button>
      </div>
      {isOpen
        ? kids.map((child) => (
            <TreeRow
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

export function WikiLinkPickerDialog({
  open,
  initialLabel = "",
  revealPath = "",
  nested = false,
  onCancel,
  onConfirm,
}: Props) {
  const tree = useVaultStore((s) => s.tree);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedIsDir, setSelectedIsDir] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [linkText, setLinkText] = useState("");
  const [autoLabel, setAutoLabel] = useState("");
  /** When the dialog opened with a non-empty label, never overwrite it on file pick. */
  const [labelLocked, setLabelLocked] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const roots = useMemo(() => {
    return (tree?.children ?? []).filter(
      (c) =>
        c.isDir && !isIncomingFolder(c.path, true) && !isTasksFolder(c.path, true),
    );
  }, [tree]);

  const flat = useMemo(() => {
    if (!tree) return [];
    return collectLinkable(tree);
  }, [tree]);

  const searchQ = search.trim().toLowerCase();
  const searchHits = useMemo(() => {
    if (!searchQ) return [];
    return flat.filter(
      (item) =>
        item.path.toLowerCase().includes(searchQ) ||
        item.name.toLowerCase().includes(searchQ),
    );
  }, [flat, searchQ]);

  useEffect(() => {
    if (!open) return;
    const startLabel = initialLabel.trim();
    setLinkText(startLabel);
    setAutoLabel("");
    setLabelLocked(Boolean(startLabel));
    setSearch("");
    setSelectedPath("");
    setSelectedIsDir(false);

    const reveal = revealPath.replace(/^\/+|\/+$/g, "");
    const folder = reveal
      ? parentPath(reveal) || (reveal.includes(".") ? "" : reveal)
      : "";
    const expandTarget = folder || reveal;
    if (expandTarget) {
      setExpanded(new Set(folderPickerExpandedPaths(expandTarget)));
    } else {
      const top = (tree?.children ?? [])
        .filter(
          (c) =>
            c.isDir &&
            !isIncomingFolder(c.path, true) &&
            !isTasksFolder(c.path, true),
        )
        .slice(0, 3)
        .map((r) => r.path);
      setExpanded(new Set(top));
    }

    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, initialLabel, revealPath, tree]);

  useEffect(() => {
    if (!open || !selectedPath || searchQ) return;
    const el = treeRef.current?.querySelector(
      `[data-wiki-link-path="${CSS.escape(selectedPath)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, selectedPath, expanded, searchQ, roots]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const resolveLabel = (path: string, isDir: boolean): string => {
    const fallback = defaultLabelFor(path, isDir);
    const trimmed = linkText.trim();
    if (labelLocked) return trimmed || fallback;
    if (!trimmed || trimmed === autoLabel) return fallback;
    return trimmed;
  };

  const applySelection = (path: string, isDir: boolean) => {
    setSelectedPath(path);
    setSelectedIsDir(isDir);
    if (labelLocked) return;
    const nextAuto = defaultLabelFor(path, isDir);
    if (!linkText.trim() || linkText === autoLabel) {
      setLinkText(nextAuto);
      setAutoLabel(nextAuto);
    }
  };

  const submit = (path = selectedPath, isDir = selectedIsDir) => {
    if (!path) return;
    onConfirm({ target: path, label: resolveLabel(path, isDir) });
  };

  return (
    <DialogShell
      open={open}
      nested={nested}
      wide
      title="Insert note link"
      description="Choose a vault note, folder, or document, then set the link text."
      onCancel={onCancel}
      className="vault-folder-pick-dialog wiki-link-pick-dialog"
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!selectedPath}
            onClick={() => submit()}
          >
            Insert
          </button>
        </>
      }
    >
      <div className="app-dialog-body vault-folder-pick-body wiki-link-pick-body">
        <label className="wiki-link-pick-field">
          <span className="wiki-link-pick-field-label">Search</span>
          <input
            ref={searchRef}
            className="wiki-link-pick-input"
            value={search}
            placeholder="Filter by name or path…"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectedPath) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>

        {searchQ ? (
          searchHits.length === 0 ? (
            <p className="vault-folder-pick-empty">No matching documents.</p>
          ) : (
            <div className="vault-folder-pick-tree" ref={treeRef}>
              {searchHits.map((item) => {
                const selected = selectedPath === item.path;
                return (
                  <div
                    key={item.path}
                    className={`vault-folder-pick-row${selected ? " is-selected" : ""}`}
                    data-wiki-link-path={item.path}
                  >
                    <span className="vault-folder-pick-chevron is-spacer" />
                    <button
                      type="button"
                      className="vault-folder-pick-label"
                      onClick={() => applySelection(item.path, item.isDir)}
                      onDoubleClick={() => {
                        applySelection(item.path, item.isDir);
                        submit(item.path, item.isDir);
                      }}
                    >
                      {item.isDir ? (
                        <FcFolder size={16} />
                      ) : (
                        <FileIcon path={item.path} />
                      )}
                      <span title={item.path}>{item.path}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : roots.length === 0 ? (
          <p className="vault-folder-pick-empty">No folders in this vault.</p>
        ) : (
          <div className="vault-folder-pick-tree" ref={treeRef}>
            {roots.map((node) => (
              <TreeRow
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                expanded={expanded}
                onToggle={toggle}
                onSelect={applySelection}
                onConfirm={(path, isDir) => {
                  applySelection(path, isDir);
                  submit(path, isDir);
                }}
              />
            ))}
          </div>
        )}

        <label className="wiki-link-pick-field">
          <span className="wiki-link-pick-field-label">Link text</span>
          <input
            className="wiki-link-pick-input"
            value={linkText}
            placeholder={
              selectedPath
                ? defaultLabelFor(selectedPath, selectedIsDir)
                : "Display text for the link"
            }
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectedPath) {
                e.preventDefault();
                submit();
              }
            }}
          />
        </label>

        {selectedPath ? (
          <div className="vault-folder-pick-current" title={selectedPath}>
            {selectedPath}
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}

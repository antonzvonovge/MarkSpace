import { useEffect, useRef, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { isUnderDiaryProject } from "../lib/diaryNotes";
import {
  CollapseAllIcon,
  CollectionPlusIcon,
  DiagramIcon,
  GraphIcon,
  LinksIcon,
  LocateIcon,
  PlusIcon,
  RefreshIcon,
  DictionaryIcon,
} from "./treeIcons";
import { GRAPH_TAB_PATH, SETTINGS_TAB_PATH } from "../store/vaultStore";

export type TreeCreateKind = "note" | "drawio" | "mdlnks" | "mddict" | "folder";

function TreeCreateMenu({
  onCreate,
  disabled,
}: {
  onCreate: (kind: TreeCreateKind) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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

  const pick = (kind: TreeCreateKind) => {
    setOpen(false);
    onCreate(kind);
  };

  return (
    <div className="tree-create" ref={rootRef}>
      <button
        type="button"
        className={open ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"}
        title={
          disabled
            ? "Create is disabled in diary projects — use New daily note in the context menu"
            : "Create"
        }
        aria-label="Create"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        <PlusIcon />
      </button>

      {open && !disabled && (
        <div className="tree-create-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("note")}
          >
            <PlusIcon />
            <span>New note</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("drawio")}
          >
            <DiagramIcon />
            <span>New diagram</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("mdlnks")}
          >
            <LinksIcon />
            <span>New links</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("mddict")}
          >
            <DictionaryIcon />
            <span>New dictionary</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("folder")}
          >
            <CollectionPlusIcon />
            <span>New folder</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function TreeToolbar({
  onCreate,
  onLocateActive,
}: {
  onCreate: (kind: TreeCreateKind) => void;
  onLocateActive: () => void;
}) {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const collapseAllFolders = useVaultStore((s) => s.collapseAllFolders);
  const openGraphTab = useVaultStore((s) => s.openGraphTab);
  const [refreshing, setRefreshing] = useState(false);
  const graphOpen = activePath === GRAPH_TAB_PATH;
  const canLocate =
    Boolean(activePath) &&
    activePath !== GRAPH_TAB_PATH &&
    activePath !== SETTINGS_TAB_PATH;
  const createDisabled = isUnderDiaryProject(
    selectedFolderPath,
    projectPropertiesByPath,
  );

  if (!vaultPath) return null;

  return (
    <div className="tree-toolbar-actions">
      <button
        type="button"
        className="tree-toolbar-btn"
        title="Refresh"
        aria-label="Refresh file tree"
        disabled={refreshing}
        onClick={() => {
          if (refreshing) return;
          setRefreshing(true);
          void refreshTree().finally(() => setRefreshing(false));
        }}
      >
        <RefreshIcon spinning={refreshing} />
      </button>
      <button
        type="button"
        className="tree-toolbar-btn"
        title="Collapse all"
        aria-label="Collapse all folders"
        disabled={expandedPaths.length === 0}
        onClick={collapseAllFolders}
      >
        <CollapseAllIcon />
      </button>
      <button
        type="button"
        className="tree-toolbar-btn"
        title="Reveal active file"
        aria-label="Reveal active file in tree"
        disabled={!canLocate}
        onClick={onLocateActive}
      >
        <LocateIcon />
      </button>
      <button
        type="button"
        className={
          graphOpen ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"
        }
        title="Tag graph"
        aria-label="Open tag graph"
        aria-pressed={graphOpen}
        onClick={() => void openGraphTab()}
      >
        <GraphIcon />
      </button>
      <TreeCreateMenu onCreate={onCreate} disabled={createDisabled} />
    </div>
  );
}

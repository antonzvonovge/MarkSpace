import { useEffect, useRef, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { isUnderDiaryProject } from "../lib/diaryNotes";
import { FcDocument } from "react-icons/fc";
import {
  CollapseAllIcon,
  CollectionPlusIcon,
  DiagramIcon,
  DictionaryIcon,
  GraphIcon,
  HabitTrackerIcon,
  CourseTrackerIcon,
  LinksIcon,
  LocateIcon,
  PlusIcon,
  RefreshIcon,
} from "./treeIcons";
import { GRAPH_TAB_PATH, SETTINGS_TAB_PATH } from "../store/vaultStore";

export type TreeCreateKind =
  | "note"
  | "drawio"
  | "mdlnks"
  | "mddict"
  | "mdhabit"
  | "mdcourse"
  | "folder";

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
            <FcDocument size={16} />
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
            onClick={() => pick("mdhabit")}
          >
            <HabitTrackerIcon />
            <span>New habit tracker</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="tree-create-item"
            onClick={() => pick("mdcourse")}
          >
            <CourseTrackerIcon />
            <span>New course</span>
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

/** Collapse tree to top level (does not hide the section). */
export function SectionCollapseButton({
  onCollapse,
  disabled,
  title = "Collapse to top level",
}: {
  onCollapse: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="tree-toolbar-btn"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onCollapse();
      }}
    >
      <CollapseAllIcon />
    </button>
  );
}

/** Sticky: Comments inbox as a flat list (vs folder tree). */
export function CommentsListSticky({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"}
      title={active ? "Show as tree" : "Show as list"}
      aria-label={active ? "Show as tree" : "Show as list"}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ListViewIcon />
    </button>
  );
}

function ListViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.25 4h9.5M3.25 8h9.5M3.25 12h9.5"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Sticky “show resolved” toggle for the Comments section header. */
export function CommentsResolvedSticky({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"}
      title={active ? "Hide resolved comments" : "Show resolved comments"}
      aria-label={active ? "Hide resolved comments" : "Show resolved comments"}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ShowResolvedIcon active={active} />
    </button>
  );
}

function ShowResolvedIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {active ? (
        <path
          fill="currentColor"
          d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm3.1 4.4-3.6 3.7a.75.75 0 0 1-1.08 0L4.9 8.05a.75.75 0 1 1 1.08-1.04l1.08 1.12 3.06-3.15a.75.75 0 1 1 1.08 1.02z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          d="M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z"
        />
      )}
    </svg>
  );
}

/** Workspace actions; collapse stays last (right edge). */
export function WorkspaceHeaderActions({
  onCreate,
  onLocateActive,
  onCollapseAll,
}: {
  onCreate: (kind: TreeCreateKind) => void;
  onLocateActive: () => void;
  onCollapseAll: () => void;
}) {
  const expandedPaths = useVaultStore((s) => s.expandedPaths);
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const refreshTree = useVaultStore((s) => s.refreshTree);
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

  return (
    <div className="section-header-actions">
      <button
        type="button"
        className="tree-toolbar-btn"
        title="Refresh"
        aria-label="Refresh file tree"
        disabled={refreshing}
        onClick={(e) => {
          e.stopPropagation();
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
        title="Reveal active file"
        aria-label="Reveal active file in tree"
        disabled={!canLocate}
        onClick={(e) => {
          e.stopPropagation();
          onLocateActive();
        }}
      >
        <LocateIcon />
      </button>
      <button
        type="button"
        className={graphOpen ? "tree-toolbar-btn is-open" : "tree-toolbar-btn"}
        title="Tag graph"
        aria-label="Open tag graph"
        aria-pressed={graphOpen}
        onClick={(e) => {
          e.stopPropagation();
          void openGraphTab();
        }}
      >
        <GraphIcon />
      </button>
      <TreeCreateMenu onCreate={onCreate} disabled={createDisabled} />
      <SectionCollapseButton
        onCollapse={onCollapseAll}
        disabled={expandedPaths.length === 0}
        title="Collapse to top level"
      />
    </div>
  );
}

/** @deprecated Prefer section header actions; kept for any stray imports. */
export function TreeToolbar({
  onCreate,
  onLocateActive,
  onCollapseAll,
}: {
  onCreate: (kind: TreeCreateKind) => void;
  onLocateActive: () => void;
  onCollapseAll?: () => void;
}) {
  const collapseAllFolders = useVaultStore((s) => s.collapseAllFolders);
  return (
    <WorkspaceHeaderActions
      onCreate={onCreate}
      onLocateActive={onLocateActive}
      onCollapseAll={onCollapseAll ?? collapseAllFolders}
    />
  );
}

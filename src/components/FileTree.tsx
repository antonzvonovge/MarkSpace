import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  emptyProjectProperties,
  getProjectProperties,
  isFolderNotePath,
  isSkillsFolder,
  isVaultProjectFolder,
  joinPath,
  parentPath,
  setProjectProperties,
  treeRevealTarget,
  type ProjectProperties,
} from "../lib/vaultApi";
import { diaryProjectRootForPath, vaultProjectRootOf } from "../lib/diaryNotes";
import { saveExpandedPaths } from "../lib/settingsStore";
import { learningLanguageFlagSvg } from "../lib/languageFlags";
import { LearningLanguageFlag } from "./LearningLanguageFlag";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import { startClipArticleJob } from "../ai/clipArticle";
import {
  startTranslateNote,
  startTranslateNoteInPlace,
} from "../ai/translateNote";
import { nativeLanguageLabel } from "../settings/types";
import { usePrefsStore } from "../store/prefsStore";
import { useChatStore } from "../store/chatStore";
import { useChatUiStore } from "../store/chatUiStore";
import {
  PromptDialog,
  ConfirmDialog,
  HabitTrackerCreateDialog,
  ProjectPropertiesDialog,
} from "./AppDialog";
import { CommentsInboxSection } from "./CommentsInboxSection";
import { IncomingSection } from "./IncomingSection";
import { buildUnresolvedCommentCounts } from "../lib/commentCounts";
import {
  loadFavoritesSectionCollapsed,
  saveFavoritesSectionCollapsed,
} from "../lib/favoritesUiState";
import {
  FcCalendar,
  FcDocument,
  FcFolder,
  FcLink,
  FcOpenedFolder,
  FcPackage,
  FcPlanner,
  FcReading,
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
  isVaultTreeDrag,
  VAULT_TREE_MIME,
} from "../lib/vaultTreeDrag";
import {
  clipboardHasOsFiles,
  collectVaultDocumentFiles,
  conflictingImportNames,
  importEntryNames,
  pathsFromClipboardData,
} from "../lib/osClipboardFiles";
import {
  CollectionPlusIcon,
  DiagramIcon,
  DictionaryIcon,
  FavoritesSectionIcon,
  HabitTrackerIcon,
  LinksIcon,
  PdfIcon,
  PlusIcon,
  VaultSectionIcon,
} from "./treeIcons";
import type { TreeCreateKind } from "./TreeToolbar";
import {
  SectionCollapseButton,
  WorkspaceHeaderActions,
} from "./TreeToolbar";

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
  projectType,
  learningLanguage,
}: {
  path: string;
  isOpen: boolean;
  size?: number;
  projectType?: string | null;
  /** When set for a language-learning project, show that country's flag. */
  learningLanguage?: string | null;
}) {
  if (isSkillsFolder(path)) return <FcWorkflow size={size} />;
  if (isVaultProjectFolder(path, true)) {
    if (projectType === "languageLearning") {
      if (learningLanguageFlagSvg(learningLanguage)) {
        return (
          <LearningLanguageFlag
            language={learningLanguage}
            className="tree-project-flag"
          />
        );
      }
    }
    if (projectType === "diary") {
      return <FcPlanner size={size} />;
    }
    return <FcPackage size={size} />;
  }
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

type PendingOsImport = {
  parent: string;
  paths: string[];
  files: File[];
  conflicts: string[];
};

/** Row under the pointer for OS file drops; vault root when over empty tree chrome. */
function vaultRowFromPointerTarget(target: EventTarget | null): {
  path: string;
  isDir: boolean;
} {
  const el = (target as HTMLElement | null)?.closest?.(
    "[data-vault-path]",
  ) as HTMLElement | null;
  if (!el || !el.hasAttribute("data-vault-path")) {
    return { path: "", isDir: true };
  }
  const path = el.getAttribute("data-vault-path") ?? "";
  const isDir = el.dataset.vaultIsdir === "1" || path === "";
  return { path, isDir };
}

function importParentFromRow(path: string, isDir: boolean): string {
  return isDir ? path : parentPath(path);
}

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

/** Prefer the folder-note mapping; also treat vault tree directories as folders. */
function resolveTreeReveal(
  path: string,
  tree: TreeNode | null,
): { treePath: string; isDir: boolean } | null {
  const mapped = treeRevealTarget(path);
  if (!mapped) return null;
  if (mapped.isDir) return mapped;
  return {
    treePath: mapped.treePath,
    isDir: Boolean(findTreeNode(tree, mapped.treePath)?.isDir),
  };
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

function collectVisibleTreeRows(
  nodes: TreeNode[],
  expandedPaths: string[],
  out: { path: string; isDir: boolean }[] = [],
): { path: string; isDir: boolean }[] {
  const expanded = new Set(expandedPaths);
  for (const node of nodes) {
    out.push({ path: node.path, isDir: node.isDir });
    if (node.isDir && expanded.has(node.path) && node.children?.length) {
      collectVisibleTreeRows(node.children, expandedPaths, out);
    }
  }
  return out;
}

function scrollTreeRowIntoView(path: string) {
  const root = document.querySelector(".tree-scroll");
  if (!root) return;
  const el = root.querySelector(
    `[data-vault-path="${CSS.escape(path)}"]`,
  ) as HTMLElement | null;
  el?.scrollIntoView({ block: "nearest" });
}

function flattenTree(root: TreeNode): NodeModel<NodeData>[] {
  const nodes: NodeModel<NodeData>[] = [];

  const walk = (node: TreeNode, parentId: string) => {
    const id = toNodeId(node.path);
    const children = node.children ?? [];
    const isMdNote =
      !node.isDir &&
      node.name.toLowerCase().endsWith(".md") &&
      !isSkillsFolder(parentPath(node.path), true);
    nodes.push({
      id,
      parent: parentId,
      text: node.name,
      // Markdown notes accept drops: they are promoted to folders on nest.
      droppable: node.isDir || isMdNote,
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

function TranslateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.75 4.25h6.5M6 4.25c0 3.5-1.75 6.25-3.5 7.5M4.25 7.5h3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.25 12.25 11.5 6.75l2.25 5.5M9.9 10.75h3.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function OpenChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.25a5.75 5.75 0 0 0-4.9 8.75L2.25 13.75l3-.7A5.75 5.75 0 1 0 8 2.25z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadArticleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.75v6.5M5.5 7.25 8 9.75l2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.25 11.25v1a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-1"
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
  onNewDailyNote,
  onNewDiagram,
  onNewLinks,
  onNewDictionary,
  onNewHabitTracker,
  onNewFolder,
  onTurnIntoFolder,
  onNewSkill,
  onDownloadArticle,
  onOpenChat,
  onTranslate,
  onTranslateReplace,
  onRename,
  onDelete,
  onReveal,
  onCopyPath,
  onCopyAbsolutePath,
  onToggleFavorite,
  onProjectProperties,
  translateLabel,
  translateReplaceLabel,
  diaryProjectRoot,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewNote: () => void;
  onNewDailyNote: () => void;
  onNewDiagram: () => void;
  onNewLinks: () => void;
  onNewDictionary: () => void;
  onNewHabitTracker: () => void;
  onNewFolder: () => void;
  onTurnIntoFolder: () => void;
  onNewSkill: () => void;
  onDownloadArticle: () => void;
  onOpenChat: () => void;
  onTranslate: () => void;
  onTranslateReplace: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onCopyAbsolutePath: () => void;
  onToggleFavorite: () => void;
  onProjectProperties: () => void;
  translateLabel: string;
  translateReplaceLabel: string;
  /** Non-null when the menu target is inside a diary project. */
  diaryProjectRoot: string | null;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isSkills = isSkillsFolder(menu.path, menu.isDir);
  const isDiary = diaryProjectRoot !== null;
  const showEditActions = !menu.createOnly && menu.path !== "" && !isSkills;
  const showCopyPath = !menu.createOnly && menu.path !== "";
  const showFavorite = !menu.createOnly && menu.path !== "";
  const showProjectProperties =
    !menu.createOnly && isVaultProjectFolder(menu.path, menu.isDir);
  const showSkillCreate = isSkills || menu.createOnly === true;
  const showStandardCreate = !isSkills;
  const showDownloadArticle =
    !menu.createOnly && menu.isDir && !isSkills;
  const showOpenChat = showProjectProperties;
  const showTranslate =
    !menu.createOnly &&
    !menu.isDir &&
    !isSkills &&
    menu.path.toLowerCase().endsWith(".md");
  const showTurnIntoFolder =
    !menu.createOnly &&
    !menu.isDir &&
    !isSkills &&
    menu.path.toLowerCase().endsWith(".md");
  const showNewFolder = showStandardCreate && !showTurnIntoFolder;

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

  const showCreate = showSkillCreate || showStandardCreate;
  const showPaths = true; // Reveal is always available
  const showContentActions =
    showDownloadArticle || showOpenChat || showTranslate;
  const showDelete = showEditActions;

  const sections: ReactNode[] = [];

  if (showFavorite) {
    sections.push(
      <button
        key="favorite"
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
      </button>,
    );
  }

  // Rename is its own group (2nd item) with separators above and below.
  if (showEditActions) {
    sections.push(
      <button
        key="rename"
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
      </button>,
    );
  }

  if (showProjectProperties) {
    sections.push(
      <button
        key="project-properties"
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
      </button>,
    );
  }

  if (showCreate) {
    sections.push(
      <div key="create">
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
            {isDiary ? (
              <button
                type="button"
                role="menuitem"
                className="tree-context-item"
                onClick={() => {
                  onClose();
                  onNewDailyNote();
                }}
              >
                <PlusIcon />
                <span>New daily note</span>
              </button>
            ) : (
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
            )}
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
                onNewDictionary();
              }}
            >
              <DictionaryIcon />
              <span>New dictionary</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tree-context-item"
              onClick={() => {
                onClose();
                onNewHabitTracker();
              }}
            >
              <HabitTrackerIcon />
              <span>New habit tracker</span>
            </button>
            {showNewFolder ? (
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
            ) : null}
            {showTurnIntoFolder ? (
              <button
                type="button"
                role="menuitem"
                className="tree-context-item"
                onClick={() => {
                  onClose();
                  onTurnIntoFolder();
                }}
              >
                <CollectionPlusIcon />
                <span>Turn into folder</span>
              </button>
            ) : null}
          </>
        ) : null}
      </div>,
    );
  }

  if (showPaths) {
    sections.push(
      <div key="paths">
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
              <span>Copy path</span>
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
      </div>,
    );
  }

  if (showContentActions) {
    sections.push(
      <div key="content-actions">
        {showOpenChat ? (
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onOpenChat();
            }}
          >
            <OpenChatIcon />
            <span>Open chat</span>
          </button>
        ) : null}
        {showDownloadArticle ? (
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={() => {
              onClose();
              onDownloadArticle();
            }}
          >
            <DownloadArticleIcon />
            <span>Download article…</span>
          </button>
        ) : null}
        {showTranslate ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="tree-context-item"
              onClick={() => {
                onClose();
                onTranslate();
              }}
            >
              <TranslateIcon />
              <span>{translateLabel}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="tree-context-item"
              onClick={() => {
                onClose();
                onTranslateReplace();
              }}
            >
              <TranslateIcon />
              <span>{translateReplaceLabel}</span>
            </button>
          </>
        ) : null}
      </div>,
    );
  }

  if (showDelete) {
    sections.push(
      <button
        key="delete"
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
      </button>,
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu"
      role="menu"
      style={{ left, top }}
    >
      {sections.flatMap((section, i) =>
        i === 0
          ? [section]
          : [
              <div
                key={`sep-${i}`}
                className="tree-context-sep"
                role="separator"
              />,
              section,
            ],
      )}
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

function TreeCommentCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="tree-comment-count" title={`${count} open comments`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function FavoritesTreeRows({
  nodes,
  depth,
  expandedPaths,
  activePath,
  selectedFolderPath,
  selectedFolderExplicit,
  treeSelectedFilePath,
  treeSelectionVisible,
  renamingPath,
  favoriteSet,
  projectPropertiesByPath,
  unresolvedCounts,
  onOpenContextMenu,
  onSelectInTree,
  onOpenFolder,
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
  treeSelectedFilePath: string | null;
  treeSelectionVisible: boolean;
  renamingPath: string | null;
  favoriteSet: Set<string>;
  projectPropertiesByPath: Record<string, ProjectProperties>;
  unresolvedCounts: Map<string, number>;
  onOpenContextMenu: (menu: ContextMenuState) => void;
  onSelectInTree: (path: string, isDir: boolean) => void;
  onOpenFolder: (path: string) => void;
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
        const isMddict = !isDir && path.toLowerCase().endsWith(".mddict");
        const isMdhabit = !isDir && path.toLowerCase().endsWith(".mdhabit");
        const isPdf = !isDir && path.toLowerCase().endsWith(".pdf");
        const selected =
          treeSelectionVisible &&
          isDir &&
          selectedFolderExplicit &&
          selectedFolderPath === path;
        const active =
          treeSelectionVisible &&
          !isDir &&
          !selectedFolderExplicit &&
          (treeSelectedFilePath ?? activePath) === path;
        const renaming = renamingPath === path;
        const openComments = unresolvedCounts.get(path) ?? 0;
        const projectRoot = vaultProjectRootOf(path);
        const projectColor =
          projectRoot && projectPropertiesByPath[projectRoot]?.color
            ? projectPropertiesByPath[projectRoot]!.color
            : "";

        return (
          <div key={`fav:${path}`} className="favorites-node">
            <div
              className={[
                "tree-row",
                isDir ? "tree-folder-row" : "tree-file",
                isProject ? "is-project" : "",
                isSkills ? "is-skills" : "",
                projectColor ? "has-project-color" : "",
                selected || active ? "is-selected" : "",
                renaming ? "is-renaming" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                // +1 — align with first branch under vault root.
                paddingLeft: `calc(var(--tree-pad-x) + ${depth + 1} * var(--tree-indent))`,
                paddingRight: "var(--tree-pad-x)",
                ...(projectColor
                  ? ({ ["--project-color"]: projectColor } as CSSProperties)
                  : null),
              }}
              data-vault-path={path}
              data-vault-isdir={isDir ? "1" : undefined}
              data-drawio-path={isDrawio ? path : undefined}
              onClick={() => {
                if (renaming) return;
                if (isDir) {
                  onOpenFolder(path);
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
                onSelectInTree(path, isDir);
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
                  <FolderTreeIcon
                    path={path}
                    isOpen={isOpen}
                    projectType={projectPropertiesByPath[path]?.projectType}
                    learningLanguage={
                      projectPropertiesByPath[path]?.projectType ===
                      "languageLearning"
                        ? projectPropertiesByPath[path]?.learningLanguage
                        : null
                    }
                  />
                ) : isDrawio ? (
                  <span className="tree-drawio-icon">
                    <DiagramIcon />
                  </span>
                ) : isMdlnks ? (
                  <FcLink size={20} />
                ) : isMddict ? (
                  <FcReading size={20} />
                ) : isMdhabit ? (
                  <FcCalendar size={20} />
                ) : isPdf ? (
                  <span className="tree-pdf-icon">
                    <PdfIcon />
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
              <TreeCommentCount count={openComments} />
            </div>

            {isDir && isOpen && hasChildren ? (
              <FavoritesTreeRows
                nodes={children}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                activePath={activePath}
                selectedFolderPath={selectedFolderPath}
                selectedFolderExplicit={selectedFolderExplicit}
                treeSelectedFilePath={treeSelectedFilePath}
                treeSelectionVisible={treeSelectionVisible}
                renamingPath={renamingPath}
                favoriteSet={favoriteSet}
                projectPropertiesByPath={projectPropertiesByPath}
                unresolvedCounts={unresolvedCounts}
                onOpenContextMenu={onOpenContextMenu}
                onSelectInTree={onSelectInTree}
                onOpenFolder={onOpenFolder}
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
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const upsertProjectProperties = useVaultStore(
    (s) => s.upsertProjectProperties,
  );
  const activePath = useVaultStore((s) => s.activePath);
  const selectedFolderPath = useVaultStore((s) => s.selectedFolderPath);
  const selectedFolderExplicit = useVaultStore((s) => s.selectedFolderExplicit);
  const treeSelectedFilePath = useVaultStore((s) => s.treeSelectedFilePath);
  const treeSelectionVisible = useVaultStore((s) => s.treeSelectionVisible);
  const createNoteInSelection = useVaultStore((s) => s.createNoteInSelection);
  const createDrawioInSelection = useVaultStore((s) => s.createDrawioInSelection);
  const createMdlnksInSelection = useVaultStore((s) => s.createMdlnksInSelection);
  const createMddictInSelection = useVaultStore((s) => s.createMddictInSelection);
  const createMdhabitInSelection = useVaultStore((s) => s.createMdhabitInSelection);
  const createFolderInSelection = useVaultStore((s) => s.createFolderInSelection);
  const createSkill = useVaultStore((s) => s.createSkill);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const nestTreeEntryUnderNote = useVaultStore((s) => s.nestTreeEntryUnderNote);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const importIntoSelection = useVaultStore((s) => s.importIntoSelection);
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const selectInTree = useVaultStore((s) => s.selectInTree);
  const openOrCreateFolderNote = useVaultStore((s) => s.openOrCreateFolderNote);
  const openNote = useVaultStore((s) => s.openNote);
  const toggleExpanded = useVaultStore((s) => s.toggleExpanded);
  const addToFavorites = useVaultStore((s) => s.addToFavorites);
  const removeFromFavorites = useVaultStore((s) => s.removeFromFavorites);
  const allComments = useVaultStore((s) => s.allComments);

  const treeRef = useRef<TreeMethods>(null);
  const treeFocusRef = useRef<HTMLDivElement | null>(null);
  /** Destination path after rename/move; remount Tree once this id exists. */
  const [pendingOpenRemapTo, setPendingOpenRemapTo] = useState<string | null>(
    null,
  );
  const [treeOpenEpoch, setTreeOpenEpoch] = useState(0);
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);
  const [promptKind, setPromptKind] = useState<PromptKind | null>(null);
  const [clipFolder, setClipFolder] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingOsImport, setPendingOsImport] =
    useState<PendingOsImport | null>(null);
  const [osDropRowPath, setOsDropRowPath] = useState<string | null>(null);
  const [projectPropsTarget, setProjectPropsTarget] =
    useState<ProjectProperties | null>(null);
  const [projectPropsLoading, setProjectPropsLoading] = useState(false);
  const [projectPropsSaving, setProjectPropsSaving] = useState(false);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(
    () => loadFavoritesSectionCollapsed(),
  );
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);

  const openProjectProperties = useCallback(async (path: string) => {
    setProjectPropsLoading(true);
    try {
      const props = await getProjectProperties(path);
      setProjectPropsTarget(props);
    } catch (err) {
      console.error("Failed to load project properties", err);
      setProjectPropsTarget(emptyProjectProperties(path));
    } finally {
      setProjectPropsLoading(false);
    }
  }, []);

  const saveProjectProperties = useCallback(
    async (value: {
      about: string;
      projectType: ProjectProperties["projectType"];
      learningLanguage: string;
      color: string;
    }) => {
      if (!projectPropsTarget) return;
      setProjectPropsSaving(true);
      try {
        const saved = await setProjectProperties(
          projectPropsTarget.path,
          value,
        );
        setProjectPropsTarget(null);
        upsertProjectProperties(saved);
        const chat = useChatStore.getState();
        if (chat.projectPath === saved.path) {
          useChatStore.setState({
            projectAbout: saved.about,
            projectType: saved.projectType,
            projectLearningLanguage: saved.learningLanguage,
          });
        }
      } catch (err) {
        console.error("Failed to save project properties", err);
      } finally {
        setProjectPropsSaving(false);
      }
    },
    [projectPropsTarget, upsertProjectProperties],
  );

  const setTreeScrollRef = useCallback((node: HTMLDivElement | null) => {
    treeFocusRef.current = node;
    setDndRoot(node);
  }, []);

  /** Restore keyboard focus to the tree after inline rename blurs the input. */
  const focusTree = useCallback(() => {
    requestAnimationFrame(() => {
      treeFocusRef.current?.focus({ preventScroll: true });
    });
  }, []);

  /**
   * After rename/move, node ids change and react-dnd-treeview treats the folder
   * as closed. Remount with remapped `initialOpen` before paint once the new id
   * is in `tree` (`open()`/`close()` close over stale state).
   */
  useLayoutEffect(() => {
    if (!pendingOpenRemapTo) return;
    if (!findTreeNode(tree, pendingOpenRemapTo)) return;
    setPendingOpenRemapTo(null);
    setTreeOpenEpoch((n) => n + 1);
  }, [tree, pendingOpenRemapTo]);

  const cancelInlineRename = useCallback(() => {
    setRenamingPath(null);
    focusTree();
  }, [focusTree]);

  const commitInlineRename = useCallback(
    (path: string, nextName: string) => {
      setRenamingPath(null);
      const trimmed = nextName.trim().replace(/[\\/]/g, "");
      if (trimmed) {
        setPendingOpenRemapTo(joinPath(parentPath(path), trimmed));
      }
      void (async () => {
        const nextPath = await renameTreeEntry(path, nextName);
        if (nextPath && nextPath !== path) {
          setPendingOpenRemapTo((prev) => (prev == null ? null : nextPath));
        } else {
          setPendingOpenRemapTo(null);
        }
        focusTree();
      })();
    },
    [focusTree, renameTreeEntry],
  );

  /** Expand every folder on the way to `path` (plus itself for folders) and scroll to it. */
  const revealPathInTree = useCallback(
    (path: string, options?: { isDir?: boolean }) => {
      const { vaultPath: vp, expandedPaths } = useVaultStore.getState();
      const toOpen = path ? ancestorFolderPaths(path) : [];
      if (path && options?.isDir) toOpen.push(path);

      const missing = toOpen.filter((a) => !expandedPaths.includes(a));
      if (missing.length > 0) {
        const next = [...expandedPaths, ...missing];
        useVaultStore.setState({ expandedPaths: next });
        if (vp) void saveExpandedPaths(vp, next);
      }

      // One call: looped open() hits stale openIds (same as collapseAll).
      treeRef.current?.open([VAULT_ID, ...toOpen.map(toNodeId)]);

      let attempts = 0;
      const scrollToRow = () => {
        const root = treeFocusRef.current;
        const el = root?.querySelector(
          `[data-vault-path="${CSS.escape(path)}"]`,
        ) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return;
        }
        if (attempts++ < 24) requestAnimationFrame(scrollToRow);
      };
      requestAnimationFrame(scrollToRow);
    },
    [],
  );

  const revealActiveInTree = useCallback(() => {
    const { activePath, tree } = useVaultStore.getState();
    if (!activePath) return;
    const target = resolveTreeReveal(activePath, tree);
    if (!target) return;
    useVaultStore.setState({
      selectedFolderExplicit: target.isDir,
      selectedFolderPath: target.isDir
        ? target.treePath
        : parentPath(activePath),
      treeSelectedFilePath: target.isDir ? null : target.treePath,
      treeSelectionVisible: true,
    });
    revealPathInTree(target.treePath, target.isDir ? { isDir: true } : undefined);
  }, [revealPathInTree]);

  /** Vault root stays open; all nested folders close (first level only). */
  const collapseAllInTree = useCallback(() => {
    const { expandedPaths } = useVaultStore.getState();
    if (expandedPaths.length === 0) return;
    // Close all nested folders in one call (looped close() hits stale openIds).
    treeRef.current?.close(expandedPaths.map(toNodeId));
    useVaultStore.getState().collapseAllFolders();
  }, []);

  /** Favorites list only: close nested folders under favorite roots. */
  const collapseFavoritesToTopLevel = useCallback(() => {
    const { expandedPaths, vaultPath: vp } = useVaultStore.getState();
    if (expandedPaths.length === 0 || favoritePaths.length === 0) return;
    const toClose = expandedPaths.filter((p) =>
      favoritePaths.some((fav) => p === fav || p.startsWith(`${fav}/`)),
    );
    if (toClose.length === 0) return;
    const closeIds = toClose.map(toNodeId);
    treeRef.current?.close(closeIds);
    const next = expandedPaths.filter((p) => !toClose.includes(p));
    useVaultStore.setState({ expandedPaths: next });
    if (vp) void saveExpandedPaths(vp, next);
  }, [favoritePaths]);

  useEffect(() => {
    if (!treeRevealRequest) return;
    const target = resolveTreeReveal(
      treeRevealRequest.path,
      useVaultStore.getState().tree,
    );
    if (!target) return;
    useVaultStore.setState({
      selectedFolderExplicit: target.isDir,
      selectedFolderPath: target.isDir
        ? target.treePath
        : parentPath(treeRevealRequest.path),
      treeSelectedFilePath: target.isDir ? null : target.treePath,
      treeSelectionVisible: true,
    });
    revealPathInTree(target.treePath, target.isDir ? { isDir: true } : undefined);
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

  const [treeDragging, setTreeDragging] = useState(false);

  // Mirror vault file drags into dataTransfer so panes outside the DnD root
  // (chat composer, note editor for .drawio) can accept native drops.
  // Also track drag lifetime so drop-target chrome cannot stick after dragend
  // (HTML5Backend / WebView2 sometimes leave isOver true).
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
      setTreeDragging(true);
      if (!isDir && path.toLowerCase().endsWith(".drawio")) {
        event.dataTransfer.setData(DRAWIO_TREE_MIME, path);
        beginDrawioTreeDrag(path);
      }
    };
    const endDragChrome = () => {
      endVaultTreeDrag();
      endDrawioTreeDrag();
      setTreeDragging(false);
      setOsDropRowPath(null);
    };
    const onDragEnd = () => {
      endDragChrome();
    };

    dndRoot.addEventListener("dragstart", onDragStart, true);
    dndRoot.addEventListener("dragend", onDragEnd, true);
    // drop/dragend outside the tree (or cancelled) must clear sticky drop-target UI.
    window.addEventListener("dragend", onDragEnd, true);
    window.addEventListener("drop", onDragEnd, true);
    return () => {
      dndRoot.removeEventListener("dragstart", onDragStart, true);
      dndRoot.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("dragend", onDragEnd, true);
      window.removeEventListener("drop", onDragEnd, true);
    };
  }, [dndRoot]);

  // F2 rename + arrow-key selection when the tree has focus.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        renamingPath ||
        promptKind ||
        clipFolder !== null ||
        deleteTarget ||
        pendingOsImport
      ) {
        return;
      }
      if (isEditableTarget(e.target)) return;
      const root = treeFocusRef.current;
      if (!root) return;
      const t = e.target as Node | null;
      if (t && !root.contains(t) && t !== root) return;

      const store = useVaultStore.getState();
      const {
        activePath,
        selectedFolderPath,
        selectedFolderExplicit,
        treeSelectedFilePath,
        tree: vaultTree,
        expandedPaths,
      } = store;

      if (e.key === "F2") {
        let target: string | null = null;
        if (selectedFolderExplicit && selectedFolderPath) {
          target = selectedFolderPath;
        } else if (treeSelectedFilePath) {
          target = treeSelectedFilePath;
        } else if (activePath) {
          target = activePath;
        }
        if (!target || isSkillsFolder(target)) return;
        e.preventDefault();
        setContextMenu(null);
        setRenamingPath(target);
        return;
      }

      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "Enter"
      ) {
        return;
      }

      const children = vaultTree?.children ?? [];
      if (!children.length) return;

      const rows = collectVisibleTreeRows(children, expandedPaths);
      if (!rows.length) return;

      const currentPath =
        selectedFolderExplicit && selectedFolderPath
          ? selectedFolderPath
          : treeSelectedFilePath
            ? treeSelectedFilePath
            : activePath && isFolderNotePath(activePath)
              ? parentPath(activePath)
              : activePath;

      let index = currentPath
        ? rows.findIndex((r) => r.path === currentPath)
        : -1;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (index < 0) {
          index = e.key === "ArrowDown" ? 0 : rows.length - 1;
        } else {
          index =
            e.key === "ArrowDown"
              ? Math.min(rows.length - 1, index + 1)
              : Math.max(0, index - 1);
        }
        const row = rows[index];
        if (!row) return;
        if (row.isDir) {
          void store.openOrCreateFolderNote(row.path);
        } else {
          void store.openNote(row.path, { preview: true });
        }
        scrollTreeRowIntoView(row.path);
        return;
      }

      if (index < 0) return;
      const row = rows[index];
      if (!row) return;

      if (e.key === "Enter") {
        e.preventDefault();
        if (row.isDir) {
          void store.openOrCreateFolderNote(row.path);
        } else {
          void store.openNote(row.path, { preview: false });
        }
        return;
      }

      if (!row.isDir) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const parent = parentPath(row.path);
          if (parent) {
            void store.openOrCreateFolderNote(parent);
            scrollTreeRowIntoView(parent);
          }
        }
        return;
      }

      // Folder: Left/Right collapse/expand (and Left climbs to parent when collapsed).
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!store.isExpanded(row.path) && row.path) {
          // Expand only when there are (or may be) children — toggle is fine.
          const node = findTreeNode(vaultTree, row.path);
          if (node?.children?.length) {
            store.toggleExpanded(row.path);
            treeRef.current?.open(toNodeId(row.path));
          }
        } else if (store.isExpanded(row.path)) {
          const node = findTreeNode(vaultTree, row.path);
          const first = node?.children?.[0];
          if (first) {
            if (first.isDir) void store.openOrCreateFolderNote(first.path);
            else void store.openNote(first.path, { preview: true });
            scrollTreeRowIntoView(first.path);
          }
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (store.isExpanded(row.path)) {
          store.toggleExpanded(row.path);
          treeRef.current?.close(toNodeId(row.path));
        } else {
          const parent = parentPath(row.path);
          if (parent) {
            void store.openOrCreateFolderNote(parent);
            scrollTreeRowIntoView(parent);
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renamingPath, promptKind, clipFolder, deleteTarget, pendingOsImport]);

  const runOsImport = useCallback(
    (parent: string, paths: string[], files: File[], overwrite: boolean) => {
      void importIntoSelection(paths, files, { parent, overwrite });
    },
    [importIntoSelection],
  );

  const beginOsImport = useCallback(
    (parent: string, data: DataTransfer | null) => {
      if (!data || !clipboardHasOsFiles(data)) return false;
      const paths = pathsFromClipboardData(data);
      const files = paths.length ? [] : collectVaultDocumentFiles(data);
      if (!paths.length && !files.length) return false;
      const names = importEntryNames(paths, files);
      const vaultTree = useVaultStore.getState().tree;
      const conflicts = conflictingImportNames(parent, names, (rel) =>
        Boolean(findTreeNode(vaultTree, rel)),
      );
      if (conflicts.length) {
        setPendingOsImport({ parent, paths, files, conflicts });
        return true;
      }
      runOsImport(parent, paths, files, false);
      return true;
    },
    [runOsImport],
  );

  const pasteOsFiles = (data: DataTransfer | null) => {
    const parent = useVaultStore.getState().selectedFolderPath;
    return beginOsImport(parent, data);
  };

  const flatTree = useMemo(() => (tree ? flattenTree(tree) : []), [tree]);

  const favoriteSet = useMemo(() => new Set(favoritePaths), [favoritePaths]);

  const unresolvedCounts = useMemo(
    () => buildUnresolvedCommentCounts(allComments),
    [allComments],
  );

  const favoriteNodes = useMemo(() => {
    if (!tree) return [] as TreeNode[];
    const nodes: TreeNode[] = [];
    for (const path of favoritePaths) {
      const node = findTreeNode(tree, path);
      if (node) nodes.push(node);
    }
    return nodes;
  }, [tree, favoritePaths]);

  const favoritesCanCollapse = useMemo(
    () =>
      expandedPaths.some((p) =>
        favoritePaths.some((fav) => p === fav || p.startsWith(`${fav}/`)),
      ),
    [expandedPaths, favoritePaths],
  );

  const toggleFavoritesCollapsed = useCallback(() => {
    setFavoritesCollapsed((prev) => {
      const next = !prev;
      saveFavoritesSectionCollapsed(next);
      return next;
    });
  }, []);

  const initialOpen = useMemo(
    () => [VAULT_ID, ...expandedPaths.map(toNodeId)],
    // Recomputed on remount after rename/move (`treeOpenEpoch`) and vault switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vaultPath, treeOpenEpoch],
  );

  if (!tree || !vaultPath) return null;

  const handleDrop = (
    _newTree: NodeModel<NodeData>[],
    options: DropOptions<NodeData>,
  ) => {
    const { dragSourceId, dropTargetId, relativeIndex, dropTarget } = options;
    if (dragSourceId == null) return;
    if (dropTargetId === TREE_ROOT) return;

    const from = toStorePath(dragSourceId);
    const targetPath = toStorePath(dropTargetId);
    if (!from) return;
    if (from === targetPath || targetPath.startsWith(`${from}/`)) return;

    const nestOntoNote =
      dropTarget &&
      !dropTarget.data?.isDir &&
      targetPath.toLowerCase().endsWith(".md");

    if (nestOntoNote) {
      void nestTreeEntryUnderNote(from, targetPath, relativeIndex ?? 0).then(
        (next) => {
          if (next && next !== from) setPendingOpenRemapTo(next);
        },
      );
      return;
    }

    void moveTreeEntry(from, targetPath, relativeIndex ?? 0).then((next) => {
      if (next && next !== from) setPendingOpenRemapTo(next);
    });
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
    if (kind === "mddict") {
      void createMddictInSelection(name).then(revealActiveInTree);
      return;
    }
    if (kind === "mdhabit") {
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
        open={promptKind !== null && promptKind !== "mdhabit"}
        title={
          promptKind === "folder"
            ? "New folder"
            : promptKind === "drawio"
              ? "New diagram"
              : promptKind === "mdlnks"
                ? "New links"
                : promptKind === "mddict"
                  ? "New dictionary"
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
                : promptKind === "mddict"
                  ? "Create a vocabulary dictionary in the selected location."
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
                : promptKind === "mddict"
                  ? "Dictionary"
                  : promptKind === "skill"
                    ? "my-skill"
                    : "Untitled"
        }
        confirmLabel="Create"
        onCancel={() => setPromptKind(null)}
        onConfirm={submitCreate}
      />

      <HabitTrackerCreateDialog
        open={promptKind === "mdhabit"}
        onCancel={() => setPromptKind(null)}
        onConfirm={(name, year) => {
          setPromptKind(null);
          void createMdhabitInSelection(name, year).then(revealActiveInTree);
        }}
      />

      <PromptDialog
        open={clipFolder !== null}
        title="Download article"
        description={
          clipFolder
            ? `Save the page as a markdown note in “${clipFolder}”. Images are downloaded into .assets/.`
            : "Save the page as a markdown note in Clippings. Images are downloaded into .assets/."
        }
        label="URL"
        defaultValue="https://"
        confirmLabel="Download"
        onCancel={() => setClipFolder(null)}
        onConfirm={(url) => {
          const folder = clipFolder;
          setClipFolder(null);
          startClipArticleJob({
            url,
            folder: folder || undefined,
          });
        }}
      />

      {contextMenu ? (
        <TreeContextMenu
          menu={contextMenu}
          diaryProjectRoot={diaryProjectRootForPath(
            contextMenu.path,
            projectPropertiesByPath,
          )}
          onClose={() => setContextMenu(null)}
          onNewNote={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("note");
          }}
          onNewDailyNote={() => {
            void useVaultStore
              .getState()
              .openOrCreateDailyNote(contextMenu.path);
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
          onNewDictionary={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("mddict");
          }}
          onNewHabitTracker={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("mdhabit");
          }}
          onNewFolder={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("folder");
          }}
          onTurnIntoFolder={() => {
            void useVaultStore.getState().promoteNoteToFolder(contextMenu.path);
          }}
          onNewSkill={() => {
            selectFolder("Skills");
            setPromptKind("skill");
          }}
          onDownloadArticle={() => {
            const folder = contextMenu.isDir
              ? contextMenu.path
              : parentPath(contextMenu.path);
            selectFolder(folder);
            setClipFolder(folder);
          }}
          onOpenChat={() => {
            useChatUiStore.getState().setOpen(true);
            void useChatStore.getState().newThread({
              projectPath: contextMenu.path,
              mode: "agent",
            });
          }}
          onTranslate={() => {
            startTranslateNote(contextMenu.path);
          }}
          onTranslateReplace={() => {
            startTranslateNoteInPlace(contextMenu.path);
          }}
          translateLabel={`Translate to ${nativeLanguageLabel(nativeLanguage)}`}
          translateReplaceLabel={`Translate and replace (${nativeLanguageLabel(nativeLanguage)})`}
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
        projectType={projectPropsTarget?.projectType ?? ""}
        learningLanguage={projectPropsTarget?.learningLanguage ?? ""}
        color={projectPropsTarget?.color ?? ""}
        saving={projectPropsSaving}
        onCancel={() => {
          if (projectPropsSaving) return;
          setProjectPropsTarget(null);
        }}
        onSave={(value) => {
          void saveProjectProperties(value);
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
                : deleteTarget?.path.endsWith(".mddict")
                  ? "Delete dictionary"
                  : deleteTarget?.path.endsWith(".mdhabit")
                    ? "Delete habit tracker"
                    : deleteTarget?.path.endsWith(".pdf")
                    ? "Delete PDF"
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

      <ConfirmDialog
        open={pendingOsImport !== null}
        title="Replace existing files?"
        description={
          pendingOsImport
            ? pendingOsImport.conflicts.length === 1
              ? `“${pendingOsImport.conflicts[0]}” already exists in this folder. Replace it?`
              : `${pendingOsImport.conflicts.length} items already exist in this folder (${pendingOsImport.conflicts
                  .slice(0, 3)
                  .join(", ")}${
                  pendingOsImport.conflicts.length > 3 ? ", …" : ""
                }). Replace them?`
            : ""
        }
        confirmLabel="Replace"
        danger
        onCancel={() => setPendingOsImport(null)}
        onConfirm={() => {
          const pending = pendingOsImport;
          setPendingOsImport(null);
          if (!pending) return;
          runOsImport(pending.parent, pending.paths, pending.files, true);
        }}
      />

      {/* Stable ref callback: an inline closure here re-runs on every render
          (detach with null → setDndRoot(null) → Tree unmounts → remounts with
          initialOpen), silently resetting expand/collapse state. */}
      <div
        className={[
          "tree-scroll",
          treeDragging ? "is-tree-dragging" : "",
          osDropRowPath !== null ? "is-os-file-dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        ref={setTreeScrollRef}
        tabIndex={0}
        onPaste={(e) => {
          if (pasteOsFiles(e.clipboardData)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDragEnterCapture={(e) => {
          if (isVaultTreeDrag(e.dataTransfer)) return;
          if (!clipboardHasOsFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          const row = vaultRowFromPointerTarget(e.target);
          setOsDropRowPath(row.path);
        }}
        onDragOverCapture={(e) => {
          if (isVaultTreeDrag(e.dataTransfer)) return;
          if (!clipboardHasOsFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
          const row = vaultRowFromPointerTarget(e.target);
          setOsDropRowPath(row.path);
        }}
        onDragLeaveCapture={(e) => {
          if (isVaultTreeDrag(e.dataTransfer)) return;
          const related = e.relatedTarget as Node | null;
          if (related && e.currentTarget.contains(related)) return;
          setOsDropRowPath(null);
        }}
        onDropCapture={(e) => {
          if (isVaultTreeDrag(e.dataTransfer)) {
            setOsDropRowPath(null);
            return;
          }
          if (!clipboardHasOsFiles(e.dataTransfer)) {
            setOsDropRowPath(null);
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const row = vaultRowFromPointerTarget(e.target);
          setOsDropRowPath(null);
          const parent = importParentFromRow(row.path, row.isDir);
          beginOsImport(parent, e.dataTransfer);
        }}
      >
        <IncomingSection />
        {favoriteNodes.length > 0 ? (
          <div className="favorites-section">
            <div className="favorites-header">
              <span
                role="button"
                tabIndex={0}
                className="tree-chevron-btn"
                aria-label={
                  favoritesCollapsed ? "Expand favorites" : "Collapse favorites"
                }
                aria-expanded={!favoritesCollapsed}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavoritesCollapsed();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavoritesCollapsed();
                  }
                }}
              >
                <ChevronIcon open={!favoritesCollapsed} />
              </span>
              <span className="favorites-header-icon" aria-hidden>
                <FavoritesSectionIcon />
              </span>
              <button
                type="button"
                className="favorites-title-btn"
                onClick={toggleFavoritesCollapsed}
              >
                <span>Favorites</span>
              </button>
              <div className="section-header-actions">
                <SectionCollapseButton
                  onCollapse={collapseFavoritesToTopLevel}
                  disabled={!favoritesCanCollapse}
                  title="Collapse to top level"
                />
              </div>
            </div>
            {!favoritesCollapsed ? (
              <FavoritesTreeRows
                nodes={favoriteNodes}
                depth={0}
                expandedPaths={expandedPaths}
                activePath={activePath}
                selectedFolderPath={selectedFolderPath}
                selectedFolderExplicit={selectedFolderExplicit}
                treeSelectedFilePath={treeSelectedFilePath}
                treeSelectionVisible={treeSelectionVisible}
                renamingPath={renamingPath}
                favoriteSet={favoriteSet}
                projectPropertiesByPath={projectPropertiesByPath}
                unresolvedCounts={unresolvedCounts}
                onOpenContextMenu={setContextMenu}
                onSelectInTree={selectInTree}
                onOpenFolder={(path) => {
                  void openOrCreateFolderNote(path);
                }}
                onOpenNote={(path, options) => {
                  void openNote(path, options);
                }}
                onToggleExpanded={toggleExpanded}
                onRenameCommit={commitInlineRename}
                onRenameCancel={cancelInlineRename}
              />
            ) : null}
          </div>
        ) : null}
        <CommentsInboxSection />
        <div className="workspace-section">
          {backendOptions ? (
          <DndProvider backend={HTML5Backend} options={backendOptions}>
            <Tree
              ref={treeRef}
              key={`${vaultPath}:${treeOpenEpoch}`}
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
                if (dropTarget?.data?.isDir) return true;

                // Nest onto a markdown note (promoted to a folder on drop).
                if (
                  dropTarget &&
                  !dropTarget.data?.isDir &&
                  targetPath.toLowerCase().endsWith(".md") &&
                  !isSkillsFolder(parentPath(targetPath), true)
                ) {
                  return true;
                }

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
                const isDir = Boolean(monitor.item.data?.isDir);
                const props = projectPropertiesByPath[dragPath];
                return (
                  <div className="dnd-preview">
                    <span className="dnd-preview-icon" aria-hidden>
                      {isDir ? (
                        <FolderTreeIcon
                          path={dragPath}
                          isOpen={false}
                          size={16}
                          projectType={props?.projectType}
                          learningLanguage={
                            props?.projectType === "languageLearning"
                              ? props.learningLanguage
                              : null
                          }
                        />
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
                const isDir = Boolean(node.data?.isDir);
                const hasChildren = Boolean(node.data?.hasChildren);
                const isVault = node.id === VAULT_ID;
                const isProject = isVaultProjectFolder(path, isDir);
                const isSkills = isSkillsFolder(path, isDir);
                const isDrawio =
                  !isDir && path.toLowerCase().endsWith(".drawio");
                const isMdlnks =
                  !isDir && path.toLowerCase().endsWith(".mdlnks");
                const isMddict =
                  !isDir && path.toLowerCase().endsWith(".mddict");
                const isMdhabit =
                  !isDir && path.toLowerCase().endsWith(".mdhabit");
                const isPdf = !isDir && path.toLowerCase().endsWith(".pdf");
                const selected =
                  treeSelectionVisible &&
                  isDir &&
                  selectedFolderExplicit &&
                  selectedFolderPath === path;
                const active =
                  treeSelectionVisible &&
                  !isDir &&
                  !selectedFolderExplicit &&
                  (treeSelectedFilePath ?? activePath) === path;
                const renaming = renamingPath === path;
                const openComments = unresolvedCounts.get(path) ?? 0;
                const projectRoot = vaultProjectRootOf(path);
                const projectColor =
                  projectRoot && projectPropertiesByPath[projectRoot]?.color
                    ? projectPropertiesByPath[projectRoot]!.color
                    : "";

                // No <button>/<a> inside the row: Chromium (WebView2) refuses to
                // start an HTML5 drag from form controls, which killed row drags
                // on Windows. Plain spans + a row-level click handler instead.
                const handleRowClick = () => {
                  treeFocusRef.current?.focus({ preventScroll: true });
                  if (renaming) return;
                  if (isDir) {
                    if (isVault || !path) {
                      selectFolder(path);
                      return;
                    }
                    void openOrCreateFolderNote(path);
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
                      projectColor ? "has-project-color" : "",
                      selected || active ? "is-selected" : "",
                      isDropTarget && treeDragging ? "is-drop-target" : "",
                      osDropRowPath !== null && path === osDropRowPath
                        ? "is-drop-target"
                        : "",
                      isDragging ? "is-dragging" : "",
                      renaming ? "is-renaming" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{
                      paddingLeft: `calc(var(--tree-pad-x) + ${depth} * var(--tree-indent))`,
                      paddingRight: "var(--tree-pad-x)",
                      ...(projectColor
                        ? ({ ["--project-color"]: projectColor } as CSSProperties)
                        : null),
                    }}
                    data-vault-path={path}
                    data-vault-isdir={isDir ? "1" : undefined}
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
                      selectInTree(path, isDir);
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
                          <VaultSectionIcon />
                        ) : (
                          <FolderTreeIcon
                            path={path}
                            isOpen={isOpen}
                            projectType={
                              projectPropertiesByPath[path]?.projectType
                            }
                            learningLanguage={
                              projectPropertiesByPath[path]?.projectType ===
                              "languageLearning"
                                ? projectPropertiesByPath[path]
                                    ?.learningLanguage
                                : null
                            }
                          />
                        )
                      ) : isDrawio ? (
                        <span className="tree-drawio-icon">
                          <DiagramIcon />
                        </span>
                      ) : isMdlnks ? (
                        <FcLink size={20} />
                      ) : isMddict ? (
                        <FcReading size={20} />
                      ) : isMdhabit ? (
                        <FcCalendar size={20} />
                      ) : isPdf ? (
                        <span className="tree-pdf-icon">
                          <PdfIcon />
                        </span>
                      ) : (
                        <FcDocument size={20} />
                      )}
                    </span>

                    {renaming ? (
                      <InlineRenameInput
                        key={path}
                        initialValue={node.text}
                        onCancel={cancelInlineRename}
                        onCommit={(nextName) => {
                          commitInlineRename(path, nextName);
                        }}
                      />
                    ) : (
                      <TreeNodeLabel text={node.text} isDir={isDir} />
                    )}
                    <TreeCommentCount count={openComments} />
                    {isVault ? (
                      <WorkspaceHeaderActions
                        onCreate={(kind) => setPromptKind(kind)}
                        onLocateActive={revealActiveInTree}
                        onCollapseAll={collapseAllInTree}
                      />
                    ) : null}
                  </div>
                );
              }}
            />
          </DndProvider>
        ) : null}
        </div>
      </div>
    </div>
  );
});

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  startTransition,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { TreeNode } from "../lib/vaultApi";
import {
  absolutePath,
  emptyProjectProperties,
  getProjectProperties,
  isFolderNotePath,
  isSkillsFolder,
  isIncomingFolder,
  isIncomingPath,
  isTasksFolder,
  INCOMING_FOLDER,
  isVaultDocumentPath,
  isVaultProjectFolder,
  parentPath,
  setProjectProperties,
  treeRevealTarget,
  type ProjectProperties,
} from "../lib/vaultApi";
import {
  diaryProjectRootForPath,
  languageLearningProjectRootForPath,
  moviesProjectRootForPath,
  vaultProjectRootOf,
} from "../lib/diaryNotes";
import { isVaultLexiconFolder, isVaultLexiconMdNote } from "../lib/lexiconNotes";
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
import type { IeltsSkill } from "../ai/ieltsFit";
import { IeltsTrainerDialog } from "./ielts/IeltsTrainerDialog";
import {
  PromptDialog,
  ConfirmDialog,
  HabitTrackerCreateDialog,
  ProjectPropertiesDialog,
} from "./AppDialog";
import { NewFilmDialog } from "./MovieDialogs";
import { CommentsInboxSection } from "./CommentsInboxSection";
import { IncomingSection } from "./IncomingSection";
import { IncomingCaptureList } from "./IncomingCaptureList";
import {
  loadIncomingCaptureEntries,
  type IncomingCaptureEntry,
} from "../lib/incomingCaptureIndex";
import {
  getIncomingCaptureRevision,
  loadIncomingListMode,
  saveIncomingListMode,
  subscribeIncomingCaptureRevision,
} from "../lib/incomingUiState";
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
  FcClapperboard,
  FcReading,
  FcReadingEbook,
  FcWorkflow,
} from "react-icons/fc";
import { MdChevronRight } from "react-icons/md";
import {
  endVaultTreeDrag,
  isVaultTreeDrag,
  vaultPathFromDrop,
} from "../lib/vaultTreeDrag";
import {
  clipboardHasOsFiles,
  collectVaultDocumentFiles,
  conflictingImportNames,
  importEntryNames,
  pathsFromClipboardData,
} from "../lib/osClipboardFiles";
import {
  DiagramIcon,
  FavoritesSectionIcon,
  CourseTrackerIcon,
  IncomingSectionIcon,
  PdfIcon,
} from "./treeIcons";
import type { TreeCreateKind } from "./TreeToolbar";
import {
  SectionCollapseButton,
} from "./TreeToolbar";
import { WorkspaceTree } from "./sidebar/WorkspaceTree";

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
  if (isIncomingFolder(path, true)) {
    return (
      <span className="incoming-section-icon" aria-hidden>
        <IncomingSectionIcon />
      </span>
    );
  }
  if (isSkillsFolder(path)) return <FcWorkflow size={size} />;
  if (isVaultLexiconFolder(path, true)) {
    return <FcReadingEbook size={size} />;
  }
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
    if (projectType === "movies") {
      return <FcClapperboard size={size} />;
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

type FileTreeProps = {
  /** Rendered inside the scroll area (between comments and workspace). */
  tasksSection?: ReactNode;
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

function isUnsupportedTreeFile(isDir: boolean, path: string): boolean {
  return !isDir && !isVaultDocumentPath(path);
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
  onNewFilm,
  onNewDiagram,
  onNewLinks,
  onNewDictionary,
  onNewHabitTracker,
  onNewCourse,
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
  onIeltsTrainer,
  translateLabel,
  translateReplaceLabel,
  diaryProjectRoot,
  moviesProjectRoot,
  languageLearningProject,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onNewNote: () => void;
  onNewDailyNote: () => void;
  onNewFilm: () => void;
  onNewDiagram: () => void;
  onNewLinks: () => void;
  onNewDictionary: () => void;
  onNewHabitTracker: () => void;
  onNewCourse: () => void;
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
  onIeltsTrainer: (skill: IeltsSkill) => void;
  translateLabel: string;
  translateReplaceLabel: string;
  /** Non-null when the menu target is inside a diary project. */
  diaryProjectRoot: string | null;
  moviesProjectRoot: string | null;
  languageLearningProject: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [ieltsOpen, setIeltsOpen] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const isSkills = isSkillsFolder(menu.path, menu.isDir);
  const isDiary = diaryProjectRoot !== null;
  const isMovies = moviesProjectRoot !== null;
  const unsupportedFile = isUnsupportedTreeFile(menu.isDir, menu.path);
  const isIncomingRoot = isIncomingFolder(menu.path, menu.isDir);
  const showEditActions =
    !menu.createOnly && menu.path !== "" && !isSkills && !isIncomingRoot;
  const showCopyPath = !menu.createOnly && menu.path !== "";
  const showFavorite =
    !menu.createOnly && menu.path !== "" && !unsupportedFile;
  const showFolderProperties =
    !menu.createOnly && menu.isDir && menu.path !== "";
  const showProjectProperties = showFolderProperties && isVaultProjectFolder(menu.path, true);
  const showSkillCreate = isSkills || menu.createOnly === true;
  const showStandardCreate = !isSkills && !unsupportedFile;
  const showDownloadArticle =
    !menu.createOnly && menu.isDir && !isSkills;
  const showOpenChat = showProjectProperties;
  const showTranslate =
    !menu.createOnly &&
    !menu.isDir &&
    !isSkills &&
    menu.path.toLowerCase().endsWith(".md") &&
    !isVaultLexiconMdNote(menu.path);
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
        {menu.isFavorite ? "Remove from favorites" : "Add to favorites"}
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
        Rename
      </button>,
    );
  }

  if (showFolderProperties) {
    sections.push(
      <button
        key="folder-properties"
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onProjectProperties();
        }}
      >
        {showProjectProperties ? "Project properties…" : "Folder properties…"}
      </button>,
    );
  }

  if (menu.isDir && languageLearningProject) {
    sections.push(
      <div
        key="ielts"
        className="tree-context-submenu-wrap"
        onMouseEnter={() => setIeltsOpen(true)}
        onMouseLeave={() => setIeltsOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          className="tree-context-item"
          onClick={(e) => {
            e.preventDefault();
            setIeltsOpen((v) => !v);
          }}
        >
          IELTS Trainer
          <MdChevronRight size={16} className="tree-context-chevron" />
        </button>
        {ieltsOpen ? (
          <div className="tree-context-submenu" role="menu">
            {(
              [
                { id: "reading" as const, label: "Reading" },
                { id: "writing" as const, label: "Writing" },
                { id: "listening" as const, label: "Listening" },
                { id: "speaking" as const, label: "Speaking" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                className="tree-context-item"
                onClick={() => {
                  onClose();
                  onIeltsTrainer(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>,
    );
  }

  if (showCreate) {
    sections.push(
      <div key="create">
        <div
          className="tree-context-submenu-wrap"
          onMouseEnter={() => setNewItemOpen(true)}
          onMouseLeave={() => setNewItemOpen(false)}
        >
          <button
            type="button"
            role="menuitem"
            className="tree-context-item"
            onClick={(e) => {
              e.preventDefault();
              setNewItemOpen((v) => !v);
            }}
          >
            New item
            <MdChevronRight size={16} className="tree-context-chevron" />
          </button>
          {newItemOpen ? (
            <div className="tree-context-submenu" role="menu">
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
                  New skill…
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
                      New daily note
                    </button>
                  ) : isMovies ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="tree-context-item"
                      onClick={() => {
                        onClose();
                        onNewFilm();
                      }}
                    >
                      New film…
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
                      New note
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
                    New diagram
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
                    New links
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
                    New dictionary
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
                    New habit tracker
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tree-context-item"
                    onClick={() => {
                      onClose();
                      onNewCourse();
                    }}
                  >
                    New course
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
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
            New folder
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
            Turn into folder
          </button>
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
          Reveal in file manager
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
              Copy path
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
              Copy absolute path
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
            Open chat
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
            Download article…
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
              {translateLabel}
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
              {translateReplaceLabel}
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
        Delete
      </button>,
    );
  }

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu is-plaintext"
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
    // Blur before unmount so focusout fires and rename lock releases.
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
  onOpenFolder: (
    path: string,
    options?: { preview?: boolean; replaceActive?: boolean },
  ) => void;
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
        const isMdcourse = !isDir && path.toLowerCase().endsWith(".mdcourse");
        const isPdf = !isDir && path.toLowerCase().endsWith(".pdf");
        const unsupported = isUnsupportedTreeFile(isDir, path);
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
                unsupported ? "is-unsupported" : "",
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
              onClick={(e) => {
                if (renaming) return;
                if (isDir) {
                  onOpenFolder(path, {
                    preview: !(e.ctrlKey || e.metaKey),
                  });
                  return;
                }
                if (isUnsupportedTreeFile(false, path)) {
                  onSelectInTree(path, false);
                  return;
                }
                onOpenNote(path, {
                  preview: !(e.ctrlKey || e.metaKey),
                });
              }}
              onDoubleClick={() => {
                if (isDir || renaming) return;
                if (isUnsupportedTreeFile(false, path)) return;
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
                  <DiagramIcon size={20} />
                ) : isMdlnks ? (
                  <FcLink size={20} />
                ) : isMddict ? (
                  <FcReading size={20} />
                ) : isMdhabit ? (
                  <FcCalendar size={20} />
                ) : isMdcourse ? (
                  <CourseTrackerIcon size={20} />
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

export const FileTree = forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
  { tasksSection = null },
  ref,
) {
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
  const createMdcourseInSelection = useVaultStore((s) => s.createMdcourseInSelection);
  const createFolderInSelection = useVaultStore((s) => s.createFolderInSelection);
  const createSkill = useVaultStore((s) => s.createSkill);
  const moveTreeEntry = useVaultStore((s) => s.moveTreeEntry);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const importIntoSelection = useVaultStore((s) => s.importIntoSelection);
  const selectFolder = useVaultStore((s) => s.selectFolder);
  const selectInTree = useVaultStore((s) => s.selectInTree);
  const openOrCreateFolderNote = useVaultStore((s) => s.openOrCreateFolderNote);
  const openIncomingTab = useVaultStore((s) => s.openIncomingTab);
  const openNote = useVaultStore((s) => s.openNote);
  const toggleExpanded = useVaultStore((s) => s.toggleExpanded);
  const addToFavorites = useVaultStore((s) => s.addToFavorites);
  const removeFromFavorites = useVaultStore((s) => s.removeFromFavorites);
  const allComments = useVaultStore((s) => s.allComments);

  const treeFocusRef = useRef<HTMLDivElement | null>(null);
  const [dndRoot, setDndRoot] = useState<HTMLDivElement | null>(null);
  const [promptKind, setPromptKind] = useState<PromptKind | null>(null);
  const [clipFolder, setClipFolder] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [ieltsTrainer, setIeltsTrainer] = useState<{
    skill: IeltsSkill;
    projectPath: string;
    folderPath: string;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingOsImport, setPendingOsImport] =
    useState<PendingOsImport | null>(null);
  const [osDropRowPath, setOsDropRowPath] = useState<string | null>(null);
  const [projectPropsTarget, setProjectPropsTarget] =
    useState<ProjectProperties | null>(null);
  const [projectPropsLoading, setProjectPropsLoading] = useState(false);
  const [projectPropsSaving, setProjectPropsSaving] = useState(false);
  const [newFilmFolder, setNewFilmFolder] = useState<string | null>(null);
  const [favoritesCollapsed, setFavoritesCollapsed] = useState(
    () => loadFavoritesSectionCollapsed(),
  );
  const [incomingListMode, setIncomingListMode] = useState(
    () => loadIncomingListMode(),
  );
  const [incomingCaptureEntries, setIncomingCaptureEntries] = useState<
    IncomingCaptureEntry[]
  >([]);
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

  const cancelInlineRename = useCallback(() => {
    setRenamingPath(null);
    focusTree();
  }, [focusTree]);

  const commitInlineRename = useCallback(
    (path: string, nextName: string) => {
      setRenamingPath(null);
      void (async () => {
        await renameTreeEntry(path, nextName);
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
    const toClose = expandedPaths.filter((p) => !isIncomingPath(p));
    if (toClose.length === 0) return;
    const next = expandedPaths.filter((p) => isIncomingPath(p));
    useVaultStore.setState({ expandedPaths: next });
    if (useVaultStore.getState().vaultPath) {
      void saveExpandedPaths(useVaultStore.getState().vaultPath!, next);
    }
  }, []);

  const onWorkspaceOpenFolder = useCallback(
    (path: string, options?: { preview?: boolean; replaceActive?: boolean }) => {
      void useVaultStore.getState().openOrCreateFolderNote(path, options);
    },
    [],
  );

  const onWorkspaceOpenNote = useCallback(
    (path: string, options?: { preview?: boolean }) => {
      void useVaultStore.getState().openNote(path, options);
    },
    [],
  );

  const onWorkspaceContextMenu = useCallback(
    (menu: {
      x: number;
      y: number;
      path: string;
      name: string;
      isDir: boolean;
      isFavorite: boolean;
    }) => {
      setContextMenu(menu);
    },
    [],
  );

  const onWorkspaceCreate = useCallback((kind: PromptKind) => {
    setPromptKind(kind);
  }, []);

  /** Favorites list only: close nested folders under favorite roots. */
  const collapseFavoritesToTopLevel = useCallback(() => {
    const { expandedPaths, vaultPath: vp } = useVaultStore.getState();
    if (expandedPaths.length === 0 || favoritePaths.length === 0) return;
    const toClose = expandedPaths.filter((p) =>
      favoritePaths.some((fav) => p === fav || p.startsWith(`${fav}/`)),
    );
    if (toClose.length === 0) return;
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

  useEffect(() => {
    if (!dndRoot) return;
    const endDragChrome = () => {
      endVaultTreeDrag();
      setOsDropRowPath(null);
    };
    const onDragEnd = () => endDragChrome();
    dndRoot.addEventListener("dragend", onDragEnd, true);
    dndRoot.addEventListener("drop", onDragEnd, true);
    window.addEventListener("dragend", onDragEnd, true);
    return () => {
      dndRoot.removeEventListener("dragend", onDragEnd, true);
      dndRoot.removeEventListener("drop", onDragEnd, true);
      window.removeEventListener("dragend", onDragEnd, true);
      endDragChrome();
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
        if (!target || isSkillsFolder(target) || isIncomingFolder(target) || isTasksFolder(target)) return;
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

      const workspaceChildren = (vaultTree?.children ?? []).filter(
        (n) =>
          !isIncomingFolder(n.path, n.isDir) && !isTasksFolder(n.path, n.isDir),
      );
      const incomingNode = vaultTree?.children?.find((n) =>
        isIncomingFolder(n.path, n.isDir),
      );
      if (!workspaceChildren.length && !incomingNode) return;

      const rows = [
        ...(incomingNode
          ? collectVisibleTreeRows([incomingNode], expandedPaths)
          : []),
        ...collectVisibleTreeRows(workspaceChildren, expandedPaths),
      ];
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


  const favoriteSet = useMemo(() => new Set(favoritePaths), [favoritePaths]);

  const unresolvedCounts = useMemo(
    () => buildUnresolvedCommentCounts(allComments),
    [allComments],
  );

  const incomingNode = useMemo((): TreeNode => {
    const found = tree?.children?.find((n) =>
      isIncomingFolder(n.path, n.isDir),
    );
    return (
      found ?? {
        name: INCOMING_FOLDER,
        path: INCOMING_FOLDER,
        isDir: true,
        children: [],
      }
    );
  }, [tree]);

  const incomingMdPaths = useMemo(() => {
    return (incomingNode.children ?? [])
      .filter((n) => !n.isDir && n.path.toLowerCase().endsWith(".md"))
      .map((n) => n.path);
  }, [incomingNode.children]);

  const incomingExpanded = expandedPaths.includes(INCOMING_FOLDER);
  const captureRevision = useSyncExternalStore(
    subscribeIncomingCaptureRevision,
    getIncomingCaptureRevision,
    getIncomingCaptureRevision,
  );

  useEffect(() => {
    if (!incomingListMode || !incomingExpanded) {
      setIncomingCaptureEntries([]);
      return;
    }
    let cancelled = false;
    void loadIncomingCaptureEntries(incomingMdPaths).then((entries) => {
      if (cancelled) return;
      startTransition(() => {
        setIncomingCaptureEntries(entries);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [incomingListMode, incomingExpanded, incomingMdPaths, captureRevision]);

  const onIncomingListModeChange = useCallback((next: boolean) => {
    setIncomingListMode(next);
    saveIncomingListMode(next);
  }, []);

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

  if (!tree || !vaultPath) return null;

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
    if (kind === "mdcourse") {
      void createMdcourseInSelection(name).then(revealActiveInTree);
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
                  : promptKind === "mdcourse"
                    ? "New course"
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
                  : promptKind === "mdcourse"
                    ? "Create a course tracker in the selected location."
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
                  : promptKind === "mdcourse"
                    ? "Course"
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

      <IeltsTrainerDialog
        open={ieltsTrainer != null}
        skill={ieltsTrainer?.skill ?? "reading"}
        projectPath={ieltsTrainer?.projectPath ?? ""}
        folderPath={ieltsTrainer?.folderPath ?? ""}
        onClose={() => setIeltsTrainer(null)}
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
          moviesProjectRoot={moviesProjectRootForPath(
            contextMenu.path,
            projectPropertiesByPath,
          )}
          languageLearningProject={
            contextMenu.isDir &&
            !contextMenu.createOnly &&
            languageLearningProjectRootForPath(
              contextMenu.path,
              projectPropertiesByPath,
            ) != null
          }
          onIeltsTrainer={(skill) => {
            const folder = contextMenu.path;
            setIeltsTrainer({
              skill,
              projectPath:
                languageLearningProjectRootForPath(
                  folder,
                  projectPropertiesByPath,
                ) ?? vaultProjectRootOf(folder) ?? folder,
              folderPath: folder,
            });
          }}
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
          onNewFilm={() => {
            const folder = contextMenu.isDir
              ? contextMenu.path
              : parentPath(contextMenu.path);
            selectFolder(folder);
            setNewFilmFolder(folder);
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
          onNewCourse={() => {
            selectFolder(
              contextMenu.isDir ? contextMenu.path : parentPath(contextMenu.path),
            );
            setPromptKind("mdcourse");
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
        isProject={
          projectPropsTarget
            ? isVaultProjectFolder(projectPropsTarget.path, true)
            : true
        }
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
                    : deleteTarget?.path.endsWith(".mdcourse")
                      ? "Delete course"
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

      <NewFilmDialog
        open={newFilmFolder !== null}
        onCancel={() => setNewFilmFolder(null)}
        onConfirm={(value) => {
          const folder = newFilmFolder ?? "";
          setNewFilmFolder(null);
          void useVaultStore.getState().createFilmNote(folder, value);
        }}
      />

      {/* Stable ref callback: an inline closure here re-runs on every render
          (detach with null → setDndRoot(null) → Tree unmounts → remounts with
          initialOpen), silently resetting expand/collapse state. */}
      <div
        className={[
          "tree-scroll",
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
          if (isVaultTreeDrag(e.dataTransfer)) {
            const row = vaultRowFromPointerTarget(e.target);
            const dest = importParentFromRow(row.path, row.isDir);
            if (isIncomingPath(dest)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
            return;
          }
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
            const row = vaultRowFromPointerTarget(e.target);
            const dest = importParentFromRow(row.path, row.isDir);
            const from = (vaultPathFromDrop(e.dataTransfer) ?? "").replace(
              /\/+$/,
              "",
            );
            setOsDropRowPath(null);
            if (
              from &&
              isIncomingPath(dest) &&
              from !== dest &&
              !dest.startsWith(`${from}/`) &&
              !isIncomingFolder(from)
            ) {
              e.preventDefault();
              e.stopPropagation();
              void moveTreeEntry(from, dest, 0);
            }
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
        <IncomingSection
          expanded={incomingExpanded}
          selected={
            treeSelectionVisible &&
            selectedFolderExplicit &&
            selectedFolderPath === INCOMING_FOLDER
          }
          hasChildren={(incomingNode.children ?? []).length > 0}
          captureCount={incomingMdPaths.length}
          listMode={incomingListMode}
          onListModeChange={onIncomingListModeChange}
          onToggle={() => toggleExpanded(INCOMING_FOLDER)}
          onOpenIncoming={() => {
            void openIncomingTab();
          }}
          onContextMenu={(x, y) => {
            setContextMenu({
              x,
              y,
              path: INCOMING_FOLDER,
              name: INCOMING_FOLDER,
              isDir: true,
              isFavorite: favoriteSet.has(INCOMING_FOLDER),
            });
            selectInTree(INCOMING_FOLDER, true);
          }}
          listContent={
            <IncomingCaptureList entries={incomingCaptureEntries} />
          }
        >
          <FavoritesTreeRows
            nodes={incomingNode.children ?? []}
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
            onOpenFolder={(path, options) => {
              void openOrCreateFolderNote(path, options);
            }}
            onOpenNote={(path, options) => {
              void openNote(path, options);
            }}
            onToggleExpanded={toggleExpanded}
            onRenameCommit={commitInlineRename}
            onRenameCancel={cancelInlineRename}
          />
        </IncomingSection>
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
                onOpenFolder={(path, options) => {
                  void openOrCreateFolderNote(path, options);
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
        {tasksSection}
        <div className="workspace-section">
          <WorkspaceTree
            tree={tree}
            expandedPaths={expandedPaths}
            projectPropertiesByPath={projectPropertiesByPath}
            unresolvedCounts={unresolvedCounts}
            renamingPath={renamingPath}
            osDropRowPath={osDropRowPath}
            scrollParentRef={treeFocusRef}
            onToggleExpanded={toggleExpanded}
            onSelectFolder={selectFolder}
            onOpenFolder={onWorkspaceOpenFolder}
            onOpenNote={onWorkspaceOpenNote}
            onSelectInTree={selectInTree}
            onContextMenu={onWorkspaceContextMenu}
            onRenameCommit={commitInlineRename}
            onRenameCancel={cancelInlineRename}
            onCreate={onWorkspaceCreate}
            onLocateActive={revealActiveInTree}
            onCollapseAll={collapseAllInTree}
            favoriteSet={favoriteSet}
          />
        </div>
      </div>
    </div>
  );
});

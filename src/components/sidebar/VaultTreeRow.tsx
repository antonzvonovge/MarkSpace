import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FcCalendar,
  FcClapperboard,
  FcDocument,
  FcFolder,
  FcLink,
  FcOpenedFolder,
  FcPackage,
  FcPlanner,
  FcReading,
  FcReadingEbook,
  FcWorkflow,
} from "react-icons/fc";
import {
  isIncomingFolder,
  isSkillsFolder,
  isVaultProjectFolder,
  type ProjectProperties,
} from "../../lib/vaultApi";
import { isVaultLexiconFolder } from "../../lib/lexiconNotes";
import { LearningLanguageFlag } from "../LearningLanguageFlag";
import { learningLanguageFlagSvg } from "../../lib/languageFlags";
import {
  CourseTrackerIcon,
  DiagramIcon,
  IncomingSectionIcon,
  PdfIcon,
  VaultSectionIcon,
} from "../treeIcons";
import type { TreeCreateKind } from "../TreeToolbar";
import { WorkspaceHeaderActions } from "../TreeToolbar";
import {
  beginDrawioTreeDrag,
  endDrawioTreeDrag,
} from "../../editor/drawio/treeDrag";
import {
  beginVaultTreeDrag,
  endVaultTreeDrag,
} from "../../lib/vaultTreeDrag";

export type PromptKind = TreeCreateKind | "skill";

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
    if (projectType === "diary") return <FcPlanner size={size} />;
    if (projectType === "movies") return <FcClapperboard size={size} />;
    return <FcPackage size={size} />;
  }
  return isOpen ? <FcOpenedFolder size={size} /> : <FcFolder size={size} />;
}

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

function TreeCommentCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="tree-comment-count" title={`${count} open comments`}>
      {count > 99 ? "99+" : count}
    </span>
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
      const lastDot = initialValue.lastIndexOf(".");
      if (lastDot > 0) input.setSelectionRange(0, lastDot);
      else input.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [initialValue]);

  const finish = (action: () => void) => {
    if (committed.current) return;
    committed.current = true;
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

export type VaultTreeRowProps = {
  path: string;
  name: string;
  isDir: boolean;
  hasChildren: boolean;
  depth: number;
  isOpen: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  isVault: boolean;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  osDropHighlight: boolean;
  openComments: number;
  projectColor: string;
  projectType?: string | null;
  learningLanguage?: string | null;
  sortable?: boolean;
  /** Drag overlay / non-sortable static paint. */
  staticRow?: boolean;
  onToggle: () => void;
  onRowClick: (e: MouseEvent) => void;
  onOpenPinned: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onRenameCommit: (nextName: string) => void;
  onRenameCancel: () => void;
  onCreate: (kind: PromptKind) => void;
  onLocateActive: () => void;
  onCollapseAll: () => void;
  style?: CSSProperties;
};

function isUnsupportedTreeFile(isDir: boolean, path: string): boolean {
  if (isDir) return false;
  const lower = path.toLowerCase();
  return !(
    lower.endsWith(".md") ||
    lower.endsWith(".drawio") ||
    lower.endsWith(".mdlnks") ||
    lower.endsWith(".mddict") ||
    lower.endsWith(".mdhabit") ||
    lower.endsWith(".mdcourse") ||
    lower.endsWith(".pdf")
  );
}

function VaultTreeRowView({
  path,
  name,
  isDir,
  hasChildren,
  depth,
  isOpen,
  isDropTarget,
  isDragging,
  isVault,
  selected,
  active,
  renaming,
  osDropHighlight,
  openComments,
  projectColor,
  projectType,
  learningLanguage,
  onToggle,
  onRowClick,
  onOpenPinned,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onCreate,
  onLocateActive,
  onCollapseAll,
  style,
  setNodeRef,
  attributes,
  listeners,
}: VaultTreeRowProps & {
  setNodeRef?: (node: HTMLElement | null) => void;
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
}) {
  const isProject = isVaultProjectFolder(path, isDir);
  const isSkills = isSkillsFolder(path, isDir);
  const unsupported = isUnsupportedTreeFile(isDir, path);
  const isDrawio = !isDir && path.toLowerCase().endsWith(".drawio");
  const isMdlnks = !isDir && path.toLowerCase().endsWith(".mdlnks");
  const isMddict = !isDir && path.toLowerCase().endsWith(".mddict");
  const isMdhabit = !isDir && path.toLowerCase().endsWith(".mdhabit");
  const isMdcourse = !isDir && path.toLowerCase().endsWith(".mdcourse");
  const isPdf = !isDir && path.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    if (!isDragging) return;
    beginVaultTreeDrag(path);
    if (isDrawio) beginDrawioTreeDrag(path);
    return () => {
      endVaultTreeDrag();
      if (isDrawio) endDrawioTreeDrag();
    };
  }, [isDragging, path, isDrawio]);

  return (
    <div
      ref={setNodeRef}
      className={[
        "tree-row",
        isDir ? "tree-folder-row" : "tree-file",
        isVault ? "is-vault-root" : "",
        isProject ? "is-project" : "",
        isSkills ? "is-skills" : "",
        unsupported ? "is-unsupported" : "",
        projectColor ? "has-project-color" : "",
        selected || active ? "is-selected" : "",
        isDropTarget ? "is-drop-target" : "",
        osDropHighlight ? "is-drop-target" : "",
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
        ...style,
      }}
      data-vault-path={path}
      data-vault-isdir={isDir ? "1" : undefined}
      data-drawio-path={isDrawio ? path : undefined}
      onClick={onRowClick}
      onDoubleClick={() => {
        if (isDir || renaming || unsupported) return;
        onOpenPinned();
      }}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {isDir ? (
        <span
          role={hasChildren ? "button" : undefined}
          tabIndex={hasChildren ? 0 : undefined}
          className={
            hasChildren ? "tree-chevron-btn" : "tree-chevron-btn is-empty"
          }
          aria-hidden={hasChildren ? undefined : true}
          aria-label={
            hasChildren ? (isOpen ? "Collapse" : "Expand") : undefined
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
          onPointerDown={(e) => e.stopPropagation()}
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
              projectType={projectType}
              learningLanguage={learningLanguage}
            />
          )
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
          initialValue={name}
          onCancel={onRenameCancel}
          onCommit={onRenameCommit}
        />
      ) : (
        <TreeNodeLabel text={name} isDir={isDir} />
      )}
      <TreeCommentCount count={openComments} />
      {isVault ? (
        <WorkspaceHeaderActions
          onCreate={onCreate}
          onLocateActive={onLocateActive}
          onCollapseAll={onCollapseAll}
        />
      ) : null}
    </div>
  );
}

export const VaultTreeRow = memo(
  function VaultTreeRow(props: VaultTreeRowProps) {
    const { sortable = true, staticRow = false } = props;

    if (staticRow || !sortable) {
      return <VaultTreeRowView {...props} />;
    }

    return <SortableVaultTreeRow {...props} />;
  },
  (a, b) =>
    a.path === b.path &&
    a.name === b.name &&
    a.isDir === b.isDir &&
    a.hasChildren === b.hasChildren &&
    a.depth === b.depth &&
    a.isOpen === b.isOpen &&
    a.isDropTarget === b.isDropTarget &&
    a.isDragging === b.isDragging &&
    a.isVault === b.isVault &&
    a.selected === b.selected &&
    a.active === b.active &&
    a.renaming === b.renaming &&
    a.osDropHighlight === b.osDropHighlight &&
    a.openComments === b.openComments &&
    a.projectColor === b.projectColor &&
    a.projectType === b.projectType &&
    a.learningLanguage === b.learningLanguage &&
    a.sortable === b.sortable &&
    a.staticRow === b.staticRow,
);

const SortableVaultTreeRow = memo(function SortableVaultTreeRow(
  props: VaultTreeRowProps,
) {
  const { path, isVault, renaming } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: path,
    disabled: isVault || renaming,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...props.style,
  };

  return (
    <VaultTreeRowView
      {...props}
      isDragging={isDragging || props.isDragging}
      setNodeRef={setNodeRef}
      attributes={attributes as unknown as Record<string, unknown>}
      listeners={listeners as unknown as Record<string, unknown>}
      style={style}
    />
  );
});

export type ProjectPropsMap = Record<string, ProjectProperties>;

export function projectMetaForPath(
  path: string,
  projectPropertiesByPath: ProjectPropsMap,
): {
  projectColor: string;
  projectType?: string | null;
  learningLanguage?: string | null;
} {
  const root =
    path === ""
      ? ""
      : path.includes("/")
        ? path.slice(0, path.indexOf("/"))
        : path;
  const props =
    path === ""
      ? undefined
      : projectPropertiesByPath[path] ?? projectPropertiesByPath[root];
  const projectRootProps = projectPropertiesByPath[root];
  return {
    projectColor: projectRootProps?.color ?? "",
    projectType: props?.projectType,
    learningLanguage:
      props?.projectType === "languageLearning"
        ? props.learningLanguage
        : null,
  };
}

export type { ReactNode };

import {
  memo,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import {
  type AnimateLayoutChanges,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskPriority } from "../../../lib/taskNotes";
import {
  TasksComposer,
  type TasksComposerDraft,
} from "../TasksComposer";
import { TasksDateField } from "../TasksDateField";
import { TaskMetaLine } from "../TaskMetaLine";
import {
  TasksIconChevron,
  TasksIconComment,
  TasksIconEdit,
  TasksIconGrip,
  TasksIconMore,
} from "../tasksIcons";
import {
  useTaskTreeActions,
  useTaskTreeEdit,
} from "./TaskTreeActionsContext";
import type { FlattenedTaskItem, TaskTreeItem } from "./types";
import { iOS } from "./utilities";

function priorityClass(priority: TaskPriority | null | undefined): string {
  if (priority == null) return "";
  return ` is-p${priority}`;
}

function CircleCheck({
  checked,
  priority,
  onClick,
}: {
  checked: boolean;
  priority?: TaskPriority | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tasks-circle${priorityClass(priority)}${checked ? " is-checked" : ""}`}
      title={checked ? "Completed" : "Mark done"}
      aria-label={checked ? "Completed" : "Mark done"}
      onClick={(e) => {
        e.stopPropagation();
        if (checked) return;
        onClick();
      }}
    >
      {checked ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tasks-icon-btn"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

/** @deprecated Prefer TaskTreeActionsProvider — kept for drag overlay. */
export type TaskTreeRowHandlers = {
  onSelect: (path: string) => void;
  onOpenComments?: (path: string) => void;
  onToggleStatus: (item: FlattenedTaskItem) => void;
  onToggleCollapse?: (path: string) => void;
  onEditTitle?: (item: TaskTreeItem) => void;
  onDueChange?: (path: string, due: string | null) => void;
  completingPaths?: ReadonlySet<string>;
  editingId?: UniqueIdentifier | null;
  editDraft?: TasksComposerDraft | null;
  editLists?: string[];
  editListColors?: Record<string, string>;
  editLabelCatalog?: string[];
  editTitleRef?: RefObject<HTMLInputElement | null>;
  onEditDraftChange?: (patch: Partial<TasksComposerDraft>) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
};

const animateLayoutChanges: AnimateLayoutChanges = () => false;

function TaskRowInner({
  item,
  selected,
  clone,
  ghost,
  handleProps,
  childCount,
  isCompleting,
  isEditing,
}: {
  item: FlattenedTaskItem;
  selected?: boolean;
  clone?: boolean;
  ghost?: boolean;
  handleProps?: Record<string, unknown>;
  childCount?: number;
  isCompleting: boolean;
  isEditing: boolean;
}) {
  const actions = useTaskTreeActions();
  const edit = useTaskTreeEdit();

  const isTask = item.kind === "task";
  const hasSubs = item.children.length > 0;
  const showExpand = hasSubs;
  const collapsed = !!item.collapsed;
  const checked = isTask && (item.status === "done" || isCompleting);

  if (isEditing && edit.editDraft) {
    return (
      <TasksComposer
        variant="row"
        draft={edit.editDraft}
        lists={edit.editLists}
        listColors={edit.editListColors}
        labelCatalog={edit.editLabelCatalog}
        titleRef={edit.editTitleRef}
        submitLabel="Save task"
        onChange={(patch) => actions.onEditDraftChange(patch)}
        onSubmit={() => actions.onCommitEdit()}
        onCancel={() => actions.onCancelEdit()}
      />
    );
  }

  return (
    <div
      className={[
        "tasks-row",
        item.kind === "sub" ? "is-sub" : "",
        selected ? "is-selected" : "",
        showExpand ? "has-expand" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ ["--tasks-drop-line-inset" as string]: "54px" }}
      onClick={() => {
        if (clone || ghost) return;
        actions.onSelect(item.path);
      }}
    >
      <span
        className="tasks-row-drag"
        aria-label="Drag to reorder or nest"
        title="Drag to reorder or nest"
        {...handleProps}
      >
        <TasksIconGrip />
      </span>
      {showExpand ? (
        <span className="tasks-row-expand">
          {!clone ? (
            <button
              type="button"
              className="tasks-expand-btn"
              aria-label={collapsed ? "Expand" : "Collapse"}
              aria-expanded={!collapsed}
              onClick={(ev) => {
                ev.stopPropagation();
                actions.onToggleCollapse(item.path);
              }}
            >
              <TasksIconChevron open={!collapsed} />
            </button>
          ) : null}
        </span>
      ) : null}
      <CircleCheck
        checked={checked}
        priority={isTask ? item.priority : null}
        onClick={() => actions.onToggleStatus(item)}
      />
      <div className="tasks-row-body">
        <span
          className={checked ? "tasks-row-title is-done" : "tasks-row-title"}
        >
          {item.title}
        </span>
        {isTask ? (
          <TaskMetaLine
            due={item.due}
            labels={item.labels}
            subtaskDone={item.subtaskDone}
            subtaskTotal={item.subtaskTotal}
            commentCount={item.commentCount}
          />
        ) : null}
      </div>
      {!clone ? (
        <div className="tasks-row-actions">
          <IconBtn label="Edit" onClick={() => actions.onEditTitle(item)}>
            <TasksIconEdit size={24} />
          </IconBtn>
          <span
            className="tasks-row-schedule"
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => ev.stopPropagation()}
          >
            <TasksDateField
              variant="icon"
              value={item.due ?? null}
              onChange={(due) => actions.onDueChange(item.path, due)}
            />
          </span>
          <IconBtn
            label="Comments"
            onClick={() =>
              (actions.onOpenComments ?? actions.onSelect)(item.path)
            }
          >
            <TasksIconComment size={24} />
          </IconBtn>
          <IconBtn label="More" onClick={() => actions.onSelect(item.path)}>
            <TasksIconMore size={24} />
          </IconBtn>
        </div>
      ) : (
        <div className="tasks-row-actions" aria-hidden="true" />
      )}
      {clone && childCount && childCount > 1 ? (
        <span className="tasks-tree-clone-count">{childCount}</span>
      ) : null}
    </div>
  );
}

type SortableRowProps = {
  id: UniqueIdentifier;
  item: FlattenedTaskItem;
  depth: number;
  indentationWidth: number;
  indicator?: boolean;
  sortable?: boolean;
  selected?: boolean;
  isCompleting: boolean;
  isEditing: boolean;
};

function SortableTaskTreeRowInner({
  id,
  item,
  depth,
  indentationWidth,
  indicator = false,
  sortable = true,
  selected,
  isCompleting,
  isEditing,
}: SortableRowProps) {
  const {
    attributes,
    isDragging,
    isSorting,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
  } = useSortable({
    id,
    animateLayoutChanges,
    disabled: !sortable || isEditing,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
  };

  const handleProps = sortable
    ? { ...attributes, ...listeners }
    : undefined;

  return (
    <li
      ref={setDroppableNodeRef}
      className={[
        "tasks-list-item",
        "tasks-tree-item",
        isDragging ? "is-ghost" : "",
        isDragging && indicator ? "is-drop-indicator" : "",
        isSorting ? "is-sorting" : "",
        isSorting ? "is-disable-interaction" : "",
        iOS ? "is-disable-selection" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          ...style,
          ["--tasks-checkbox-inset" as string]: "54px",
          ["--tasks-tree-pad" as string]: `${depth * indentationWidth}px`,
          ["--tasks-drop-line-pad" as string]: `${depth * indentationWidth}px`,
          ["--tasks-indent-width" as string]: `${indentationWidth}px`,
          paddingLeft: `${depth * indentationWidth}px`,
        } as CSSProperties
      }
    >
      <div ref={setDraggableNodeRef}>
        <TaskRowInner
          item={item}
          selected={selected}
          ghost={isDragging}
          handleProps={handleProps}
          isCompleting={isCompleting}
          isEditing={isEditing}
        />
      </div>
    </li>
  );
}

function rowPropsEqual(
  prev: SortableRowProps,
  next: SortableRowProps,
): boolean {
  return (
    prev.id === next.id &&
    prev.item === next.item &&
    prev.depth === next.depth &&
    prev.indentationWidth === next.indentationWidth &&
    prev.indicator === next.indicator &&
    prev.sortable === next.sortable &&
    prev.selected === next.selected &&
    prev.isCompleting === next.isCompleting &&
    prev.isEditing === next.isEditing
  );
}

export const SortableTaskTreeRow = memo(SortableTaskTreeRowInner, rowPropsEqual);

/** Drag overlay clone (card under cursor). */
export function TaskTreeDragOverlay({
  item,
  childCount,
}: {
  item: FlattenedTaskItem;
  childCount?: number;
}) {
  return (
    <div className="tasks-tree-overlay">
      <TaskRowInner
        item={item}
        clone
        childCount={childCount}
        isCompleting={false}
        isEditing={false}
      />
    </div>
  );
}

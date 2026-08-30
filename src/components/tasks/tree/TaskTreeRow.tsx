import { type CSSProperties, type ReactNode, type RefObject } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import {
  type AnimateLayoutChanges,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskPriority } from "../../../lib/taskNotes";
import { TasksDateField } from "../TasksDateField";
import {
  TasksIconChevron,
  TasksIconComment,
  TasksIconEdit,
  TasksIconGrip,
  TasksIconMore,
  TasksIconSubtasks,
} from "../tasksIcons";
import type { FlattenedTaskItem, TaskTreeItem } from "./types";

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
      title={checked ? "Mark open" : "Mark done"}
      aria-label={checked ? "Mark open" : "Mark done"}
      onClick={(e) => {
        e.stopPropagation();
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

export type TaskTreeRowHandlers = {
  onSelect: (path: string) => void;
  onToggleStatus: (item: FlattenedTaskItem) => void;
  onToggleCollapse?: (path: string) => void;
  onEditTitle?: (item: TaskTreeItem) => void;
  onDueChange?: (path: string, due: string | null) => void;
  editingId?: UniqueIdentifier | null;
  editTitle?: string;
  onEditTitleChange?: (v: string) => void;
  onCommitEdit?: (item: TaskTreeItem, title: string) => void;
  onCancelEdit?: () => void;
  editInputRef?: RefObject<HTMLInputElement | null>;
};

const animateLayoutChanges: AnimateLayoutChanges = ({
  isSorting,
  wasDragging,
}) => (isSorting || wasDragging ? false : true);

function TaskRowInner({
  item,
  handlers,
  selected,
  clone,
  ghost,
  handleProps,
  childCount,
}: {
  item: FlattenedTaskItem;
  handlers: TaskTreeRowHandlers;
  selected?: boolean;
  clone?: boolean;
  ghost?: boolean;
  handleProps?: Record<string, unknown>;
  childCount?: number;
}) {
  const isTask = item.kind === "task";
  const hasSubs = item.children.length > 0;
  const showExpand = hasSubs;
  const collapsed = !!item.collapsed;
  const editing =
    String(handlers.editingId) === String(item.id) && !clone && !ghost;

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
        if (editing || clone || ghost) return;
        handlers.onSelect(item.path);
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
          {handlers.onToggleCollapse && !clone ? (
            <button
              type="button"
              className="tasks-expand-btn"
              aria-label={collapsed ? "Expand" : "Collapse"}
              aria-expanded={!collapsed}
              onClick={(ev) => {
                ev.stopPropagation();
                handlers.onToggleCollapse?.(item.path);
              }}
            >
              <TasksIconChevron open={!collapsed} />
            </button>
          ) : null}
        </span>
      ) : null}
      <CircleCheck
        checked={item.status === "done"}
        priority={isTask ? item.priority : null}
        onClick={() => handlers.onToggleStatus(item)}
      />
      <div className="tasks-row-body">
        {editing ? (
          <input
            ref={handlers.editInputRef}
            className="tasks-row-inline-edit"
            value={handlers.editTitle ?? item.title}
            onChange={(ev) => handlers.onEditTitleChange?.(ev.target.value)}
            onClick={(ev) => ev.stopPropagation()}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                handlers.onCommitEdit?.(
                  item,
                  handlers.editTitle ?? item.title,
                );
              }
              if (ev.key === "Escape") handlers.onCancelEdit?.();
            }}
            onBlur={() =>
              handlers.onCommitEdit?.(item, handlers.editTitle ?? item.title)
            }
            aria-label="Edit task title"
          />
        ) : (
          <span
            className={
              item.status === "done"
                ? "tasks-row-title is-done"
                : "tasks-row-title"
            }
          >
            {item.title}
          </span>
        )}
        {!editing &&
        isTask &&
        ((item.subtaskTotal ?? 0) > 0 ||
          item.due ||
          (item.commentCount ?? 0) > 0) ? (
          <span className="tasks-row-meta">
            {(item.subtaskTotal ?? 0) > 0 ? (
              <span className="tasks-row-progress">
                <TasksIconSubtasks />
                {item.subtaskDone}/{item.subtaskTotal}
              </span>
            ) : null}
            {item.due ? (
              <span className="tasks-row-due">{item.due}</span>
            ) : null}
            {(item.commentCount ?? 0) > 0 ? (
              <span className="tasks-row-comments">{item.commentCount}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {!clone ? (
        <div className="tasks-row-actions">
          <IconBtn
            label="Edit"
            onClick={() => handlers.onEditTitle?.(item)}
          >
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
              onChange={(due) => handlers.onDueChange?.(item.path, due)}
            />
          </span>
          <IconBtn label="Comments" onClick={() => handlers.onSelect(item.path)}>
            <TasksIconComment size={24} />
          </IconBtn>
          <IconBtn label="More" onClick={() => handlers.onSelect(item.path)}>
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

export function SortableTaskTreeRow({
  id,
  item,
  depth,
  indentationWidth,
  indicator,
  handlers,
  selected,
}: {
  id: UniqueIdentifier;
  item: FlattenedTaskItem;
  depth: number;
  indentationWidth: number;
  /** When set, this row is the drop placeholder (thin line at projected depth). */
  indicator?: boolean;
  handlers: TaskTreeRowHandlers;
  selected?: boolean;
}) {
  const {
    attributes,
    isDragging,
    isSorting,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    transform,
    transition,
  } = useSortable({ id, animateLayoutChanges });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <li
      ref={setDroppableNodeRef}
      className={[
        "tasks-list-item",
        "tasks-tree-item",
        isDragging ? "is-ghost" : "",
        indicator ? "is-drop-indicator" : "",
        isSorting ? "is-sorting" : "",
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
          handlers={handlers}
          selected={selected}
          ghost={isDragging}
          handleProps={{ ...attributes, ...listeners }}
        />
      </div>
    </li>
  );
}

/** Drag overlay clone (card under cursor). */
export function TaskTreeDragOverlay({
  item,
  childCount,
  handlers,
}: {
  item: FlattenedTaskItem;
  childCount?: number;
  handlers: TaskTreeRowHandlers;
}) {
  return (
    <div className="tasks-tree-overlay">
      <TaskRowInner
        item={item}
        handlers={handlers}
        clone
        childCount={childCount}
      />
    </div>
  );
}

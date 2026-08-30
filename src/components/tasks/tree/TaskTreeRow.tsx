import { type CSSProperties, type ReactNode, type RefObject } from "react";
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

export type TaskTreeRowHandlers = {
  onSelect: (path: string) => void;
  /** Open task detail focused on the comment composer. */
  onOpenComments?: (path: string) => void;
  onToggleStatus: (item: FlattenedTaskItem) => void;
  onToggleCollapse?: (path: string) => void;
  onEditTitle?: (item: TaskTreeItem) => void;
  onDueChange?: (path: string, due: string | null) => void;
  /** Paths mid complete animation (show check before row disappears). */
  completingPaths?: ReadonlySet<string>;
  editingId?: UniqueIdentifier | null;
  editDraft?: TasksComposerDraft | null;
  editLists?: string[];
  editLabelCatalog?: string[];
  editTitleRef?: RefObject<HTMLInputElement | null>;
  onEditDraftChange?: (patch: Partial<TasksComposerDraft>) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
};

const animateLayoutChanges: AnimateLayoutChanges = () => false;

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
  const completing = handlers.completingPaths?.has(item.path) ?? false;
  const checked = isTask && (item.status === "done" || completing);

  if (editing && handlers.editDraft) {
    return (
      <TasksComposer
        variant="row"
        draft={handlers.editDraft}
        lists={handlers.editLists ?? []}
        labelCatalog={handlers.editLabelCatalog ?? []}
        titleRef={handlers.editTitleRef}
        submitLabel="Save task"
        onChange={(patch) => handlers.onEditDraftChange?.(patch)}
        onSubmit={() => handlers.onCommitEdit?.()}
        onCancel={() => handlers.onCancelEdit?.()}
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
        checked={checked}
        priority={isTask ? item.priority : null}
        onClick={() => handlers.onToggleStatus(item)}
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
          <IconBtn
            label="Comments"
            onClick={() =>
              (handlers.onOpenComments ?? handlers.onSelect)(item.path)
            }
          >
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
  indicator = false,
  sortable = true,
  handlers,
  selected,
}: {
  id: UniqueIdentifier;
  item: FlattenedTaskItem;
  depth: number;
  indentationWidth: number;
  /** Drop-line mode (dnd-kit `indicator` prop) — applied on the ghost while dragging. */
  indicator?: boolean;
  /** When false, grip has no drag listeners (Today). */
  sortable?: boolean;
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
  } = useSortable({
    id,
    animateLayoutChanges,
    disabled:
      !sortable || String(handlers.editingId) === String(id),
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    // No CSS transition: drop must land in place without sliding via old slot.
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
          handlers={handlers}
          selected={selected}
          ghost={isDragging}
          handleProps={handleProps}
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

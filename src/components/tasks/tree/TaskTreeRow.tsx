import { memo, useState, type CSSProperties, type ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import {
  type AnimateLayoutChanges,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskPriority } from "../../../lib/taskNotes";
import {
  TasksComposer,
} from "../TasksComposer";
import { TaskMetaLine } from "../TaskMetaLine";
import {
  TasksIconChevron,
  TasksIconComment,
  TasksIconEdit,
  TasksIconGrip,
  TasksIconMore,
  TasksIconSchedule,
  TasksIconSubtasks,
} from "../tasksIcons";
import {
  useTaskTreeActions,
  type TaskTreeEditState,
} from "./TaskTreeActionsContext";
import type { FlattenedTaskItem } from "./types";
import type { TaskTreeAddSubtaskSlot } from "./taskTreeDisplayRows";
import { TaskTreeAddSlot } from "./TaskTreeAddRow";
import { iOS, MAX_TASK_TREE_DEPTH } from "./utilities";

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
  onClick?: (e: ReactMouseEvent) => void;
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
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}

const animateLayoutChanges: AnimateLayoutChanges = () => false;

function TaskRowEditing({ edit }: { edit: TaskTreeEditState }) {
  const actions = useTaskTreeActions();
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

type TaskRowDisplayProps = {
  item: FlattenedTaskItem;
  selected?: boolean;
  clone?: boolean;
  ghost?: boolean;
  handleProps?: Record<string, unknown>;
  childCount?: number;
  isCompleting: boolean;
  todayYmd: string;
  showListChip?: boolean;
  listColors?: Record<string, string>;
  showDragHandle?: boolean;
  dragHandleRef?: (element: HTMLElement | null) => void;
};

const TaskRowDisplay = memo(function TaskRowDisplay({
  item,
  selected,
  clone,
  ghost,
  handleProps,
  dragHandleRef,
  childCount,
  isCompleting,
  todayYmd,
  showListChip = false,
  listColors = {},
  showDragHandle = true,
}: TaskRowDisplayProps) {
  const actions = useTaskTreeActions();
  const [hovered, setHovered] = useState(false);
  const isTask = item.kind === "task";
  const hasSubs = item.children.length > 0;
  const showExpand = hasSubs;
  const collapsed = !!item.collapsed;
  const checked = isTask && (item.status === "done" || isCompleting);
  const showChrome = !clone && !ghost && (hovered || selected);
  const listName = item.list?.trim() || "Inbox";
  const listColor = listColors[listName] ?? "";

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
      onMouseEnter={() => {
        if (!clone && !ghost) setHovered(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (clone || ghost) return;
        actions.onSelect(item.path);
      }}
    >
      {showDragHandle && handleProps && (showChrome || ghost) ? (
        <span
          ref={dragHandleRef}
          className="tasks-row-drag"
          aria-label="Drag to reorder or nest"
          title="Drag to reorder or nest"
          {...handleProps}
        >
          <TasksIconGrip />
        </span>
      ) : null}
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
            todayYmd={todayYmd}
            list={listName}
            listColor={listColor}
            showList={showListChip}
          />
        ) : null}
      </div>
      {!clone ? (
        showChrome ? (
          <div className="tasks-row-actions">
            <IconBtn label="Edit" onClick={() => actions.onEditTitle(item)}>
              <TasksIconEdit size={24} />
            </IconBtn>
            {item.depth < MAX_TASK_TREE_DEPTH ? (
              <IconBtn
                label="Add subtask"
                onClick={() => actions.onStartAddSubtask(item.path)}
              >
                <TasksIconSubtasks size={24} />
              </IconBtn>
            ) : null}
            <IconBtn
              label="Due date"
              onClick={(e) => {
                actions.onPickDue(item.path, e.clientX, e.clientY);
              }}
            >
              <TasksIconSchedule
                size={24}
                className={
                  item.due
                    ? "tasks-row-schedule-icon has-value"
                    : "tasks-row-schedule-icon"
                }
              />
            </IconBtn>
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
          <div className="tasks-row-actions-spacer" aria-hidden="true" />
        )
      ) : (
        <div className="tasks-row-actions" aria-hidden="true" />
      )}
      {clone && childCount && childCount > 1 ? (
        <span className="tasks-tree-clone-count">{childCount}</span>
      ) : null}
    </div>
  );
});

function TaskRowInner({
  item,
  selected,
  clone,
  ghost,
  handleProps,
  dragHandleRef,
  childCount,
  isCompleting,
  isEditing,
  edit,
  todayYmd,
  showListChip,
  listColors,
  showDragHandle,
}: TaskRowDisplayProps & {
  isEditing: boolean;
  edit?: TaskTreeEditState | null;
}) {
  if (isEditing && edit) {
    return <TaskRowEditing edit={edit} />;
  }
  return (
    <TaskRowDisplay
      item={item}
      selected={selected}
      clone={clone}
      ghost={ghost}
      handleProps={handleProps}
      dragHandleRef={dragHandleRef}
      childCount={childCount}
      isCompleting={isCompleting}
      todayYmd={todayYmd}
      showListChip={showListChip}
      listColors={listColors}
      showDragHandle={showDragHandle}
    />
  );
}

type SortableRowProps = {
  id: UniqueIdentifier;
  item: FlattenedTaskItem & { addSubtaskAfter?: TaskTreeAddSubtaskSlot };
  depth: number;
  indentationWidth: number;
  indicator?: boolean;
  sortable?: boolean;
  selected?: boolean;
  isCompleting: boolean;
  isEditing: boolean;
  edit?: TaskTreeEditState | null;
  todayYmd: string;
  showListChip?: boolean;
  listColors?: Record<string, string>;
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
  edit,
  todayYmd,
  showListChip,
  listColors,
}: SortableRowProps) {
  const {
    attributes,
    isDragging,
    isSorting,
    listeners,
    setActivatorNodeRef,
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
          dragHandleRef={setActivatorNodeRef}
          isCompleting={isCompleting}
          isEditing={isEditing}
          edit={edit}
          todayYmd={todayYmd}
          showListChip={showListChip}
          listColors={listColors}
          showDragHandle={sortable}
        />
      </div>
      {item.addSubtaskAfter ? (
        <TaskTreeAddSlot slot={item.addSubtaskAfter} hostDepth={depth} />
      ) : null}
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
    prev.isEditing === next.isEditing &&
    prev.edit === next.edit &&
    prev.todayYmd === next.todayYmd &&
    prev.showListChip === next.showListChip &&
    prev.listColors === next.listColors
  );
}

export const SortableTaskTreeRow = memo(SortableTaskTreeRowInner, rowPropsEqual);

type StaticRowProps = Omit<SortableRowProps, "id" | "indicator" | "sortable">;

function StaticTaskTreeRowInner({
  item,
  depth,
  indentationWidth,
  selected,
  isCompleting,
  isEditing,
  edit,
  todayYmd,
  showListChip,
  listColors,
}: StaticRowProps) {
  return (
    <li
      className="tasks-list-item tasks-tree-item"
      style={
        {
          ["--tasks-checkbox-inset" as string]: "54px",
          ["--tasks-tree-pad" as string]: `${depth * indentationWidth}px`,
          ["--tasks-drop-line-pad" as string]: `${depth * indentationWidth}px`,
          ["--tasks-indent-width" as string]: `${indentationWidth}px`,
          paddingLeft: `${depth * indentationWidth}px`,
        } as CSSProperties
      }
    >
      <TaskRowInner
        item={item}
        selected={selected}
        isCompleting={isCompleting}
        isEditing={isEditing}
        edit={edit}
        todayYmd={todayYmd}
        showListChip={showListChip}
        listColors={listColors}
        showDragHandle={false}
      />
      {item.addSubtaskAfter ? (
        <TaskTreeAddSlot slot={item.addSubtaskAfter} hostDepth={depth} />
      ) : null}
    </li>
  );
}

function staticRowPropsEqual(prev: StaticRowProps, next: StaticRowProps): boolean {
  return (
    prev.item === next.item &&
    prev.depth === next.depth &&
    prev.indentationWidth === next.indentationWidth &&
    prev.selected === next.selected &&
    prev.isCompleting === next.isCompleting &&
    prev.isEditing === next.isEditing &&
    prev.edit === next.edit &&
    prev.todayYmd === next.todayYmd &&
    prev.showListChip === next.showListChip &&
    prev.listColors === next.listColors
  );
}

export const StaticTaskTreeRow = memo(StaticTaskTreeRowInner, staticRowPropsEqual);

/** Drag overlay clone (card under cursor). */
export function TaskTreeDragOverlay({
  item,
  childCount,
  todayYmd,
}: {
  item: FlattenedTaskItem;
  childCount?: number;
  todayYmd: string;
}) {
  return (
    <div className="tasks-tree-overlay">
      <TaskRowDisplay
        item={item}
        clone
        childCount={childCount}
        isCompleting={false}
        todayYmd={todayYmd}
      />
    </div>
  );
}

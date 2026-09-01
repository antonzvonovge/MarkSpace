import { memo, type CSSProperties } from "react";
import {
  formatTaskDueLabel,
  localDateYmd,
} from "../../lib/taskNotes";
import { pastelChipForName } from "../../lib/pastelChipColors";
import { TasksInboxIcon, TasksListIcon } from "../treeIcons";
import {
  TasksIconComment,
  TasksIconLabel,
  TasksIconSchedule,
  TasksIconSubtasks,
} from "./tasksIcons";

type Props = {
  due?: string | null;
  labels?: readonly string[];
  subtaskDone?: number;
  subtaskTotal?: number;
  commentCount?: number;
  /** Hide subtask progress (e.g. already under a parent in detail). */
  hideSubtasks?: boolean;
  /** Caller-supplied today (YYYY-MM-DD) — avoids per-row date work. */
  todayYmd?: string;
  /** Task list / project folder name (shown when showList is true). */
  list?: string;
  listColor?: string;
  showList?: boolean;
};

/** Compact meta under a task title: progress / due / labels / comments (when present). */
export const TaskMetaLine = memo(function TaskMetaLine({
  due,
  labels,
  subtaskDone = 0,
  subtaskTotal = 0,
  commentCount = 0,
  hideSubtasks = false,
  todayYmd,
  list,
  listColor,
  showList = false,
}: Props) {
  const dueLabel = formatTaskDueLabel(due, todayYmd ?? localDateYmd());
  const labelList = (labels ?? []).map((l) => l.trim()).filter(Boolean);
  const listName = list?.trim() || "Inbox";
  const showProgress = !hideSubtasks && subtaskTotal > 0;
  const showComments = commentCount > 0;
  const showListChip = showList && !!listName;
  if (
    !dueLabel &&
    labelList.length === 0 &&
    !showProgress &&
    !showComments &&
    !showListChip
  ) {
    return null;
  }

  return (
    <span className="tasks-row-meta">
      {showListChip ? (
        <span className="tasks-row-list icon-text">
          <span
            className={
              listColor
                ? "icon-text-glyph tasks-row-list-icon has-list-color"
                : "icon-text-glyph tasks-row-list-icon"
            }
            aria-hidden="true"
            style={
              listColor ? ({ color: listColor } as CSSProperties) : undefined
            }
          >
            {listName === "Inbox" ? (
              <TasksInboxIcon />
            ) : (
              <TasksListIcon color={listColor || undefined} />
            )}
          </span>
          <span>{listName}</span>
        </span>
      ) : null}
      {showProgress ? (
        <span className="tasks-row-progress">
          <TasksIconSubtasks />
          {subtaskDone}/{subtaskTotal}
        </span>
      ) : null}
      {dueLabel ? (
        <span className="tasks-row-due">
          <TasksIconSchedule size={12} className="tasks-row-meta-icon" />
          {dueLabel}
        </span>
      ) : null}
      {labelList.map((label) => {
        const swatch = pastelChipForName(label);
        return (
          <span
            key={label}
            className="tasks-row-label"
            style={{ color: swatch.text }}
          >
            <TasksIconLabel size={11} className="tasks-row-meta-icon" />
            {label}
          </span>
        );
      })}
      {showComments ? (
        <span className="tasks-row-comments" title="Comments">
          <TasksIconComment size={12} className="tasks-row-meta-icon" />
          {commentCount}
        </span>
      ) : null}
    </span>
  );
});

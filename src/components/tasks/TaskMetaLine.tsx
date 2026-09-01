import { memo } from "react";
import {
  formatTaskDueLabel,
  localDateYmd,
} from "../../lib/taskNotes";
import { pastelChipForName } from "../../lib/pastelChipColors";
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
}: Props) {
  const dueLabel = formatTaskDueLabel(due, todayYmd ?? localDateYmd());
  const labelList = (labels ?? []).map((l) => l.trim()).filter(Boolean);
  const showProgress = !hideSubtasks && subtaskTotal > 0;
  const showComments = commentCount > 0;
  if (!dueLabel && labelList.length === 0 && !showProgress && !showComments) {
    return null;
  }

  return (
    <span className="tasks-row-meta">
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

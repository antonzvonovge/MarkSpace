import { memo, type CSSProperties } from "react";
import { TasksComposer } from "../TasksComposer";
import {
  TasksIconAddPlusActive,
  TasksIconAddPlusIdle,
} from "../tasksIcons";
import {
  useTaskTreeAddComposer,
  type TaskTreeAddComposerState,
} from "./TaskTreeAddComposerContext";
import type { TaskTreeAddSubtaskSlot } from "./taskTreeDisplayRows";

function TaskTreeAddSlotInner({
  slot,
  hostDepth,
  composer,
}: {
  slot: TaskTreeAddSubtaskSlot;
  hostDepth: number;
  composer: TaskTreeAddComposerState;
}) {
  const isOpen = composer.addComposerParentPath === slot.parentPath;
  const extraPad = Math.max(0, slot.slotDepth - hostDepth) * composer.indentationWidth;

  return (
    <div
      className="tasks-tree-add-row"
      style={
        extraPad
          ? ({ paddingLeft: `${extraPad}px` } as CSSProperties)
          : undefined
      }
    >
      {isOpen ? (
        <TasksComposer
          variant="row"
          draft={composer.draft}
          lists={composer.lists}
          listColors={composer.listColors}
          labelCatalog={composer.labelCatalog}
          titleRef={composer.titleRef}
          submitLabel="Add subtask"
          onChange={composer.onPatchDraft}
          onSubmit={() => composer.onSubmit(slot.parentPath)}
          onCancel={composer.onCancel}
          onBlurEmpty={composer.onCancel}
        />
      ) : (
        <button
          type="button"
          className="tasks-add-trigger tasks-tree-add-trigger"
          onClick={() => composer.onStartAddSubtask(slot.parentPath)}
        >
          <span className="tasks-add-icon" aria-hidden="true">
            <TasksIconAddPlusIdle className="tasks-add-icon-idle" size={18} />
            <TasksIconAddPlusActive className="tasks-add-icon-active" size={18} />
          </span>
          Add subtask
        </button>
      )}
    </div>
  );
}

export const TaskTreeAddSlot = memo(function TaskTreeAddSlot({
  slot,
  hostDepth,
}: {
  slot: TaskTreeAddSubtaskSlot;
  hostDepth: number;
}) {
  const composer = useTaskTreeAddComposer();
  if (!composer) return null;
  return (
    <TaskTreeAddSlotInner slot={slot} hostDepth={hostDepth} composer={composer} />
  );
});

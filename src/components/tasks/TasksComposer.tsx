import type { RefObject } from "react";
import type { TaskPriority } from "../../lib/taskNotes";
import { TagChipsInput } from "../TagChipsInput";
import { TasksComposerPicker } from "./TasksComposerPicker";
import { TasksDateField } from "./TasksDateField";
import { TasksPriorityPicker } from "./TasksPriorityPicker";

export type TasksComposerDraft = {
  title: string;
  due: string;
  priority: TaskPriority | "";
  /** Task-scoped labels (same UX as tags; stored in frontmatter `labels:`). */
  labels: string[];
  list: string;
};

type Props = {
  draft: TasksComposerDraft;
  lists: string[];
  /** List name → Material swatch hex. */
  listColors?: Record<string, string>;
  /** Catalog of known task labels (not vault note tags). */
  labelCatalog: string[];
  titleRef?: RefObject<HTMLInputElement | null>;
  /** `row` replaces a task line; `footer` is the add-task composer. */
  variant?: "footer" | "row";
  submitLabel?: string;
  onChange: (patch: Partial<TasksComposerDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

export function TasksComposer({
  draft,
  lists,
  listColors,
  labelCatalog,
  titleRef,
  variant = "footer",
  submitLabel = "Save",
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const currentList = draft.list.trim() || "Inbox";
  const listOptions = [
    { value: "Inbox", label: "Inbox" },
    ...lists
      .filter((l) => l !== "Inbox")
      .map((l) => ({
        value: l,
        label: l,
        color: listColors?.[l] || undefined,
      })),
  ];
  // Ensure the active/context list appears even if the tree briefly omits it.
  if (
    currentList !== "Inbox" &&
    !listOptions.some((o) => o.value === currentList)
  ) {
    listOptions.push({
      value: currentList,
      label: currentList,
      color: listColors?.[currentList] || undefined,
    });
  }

  return (
    <div
      className={
        variant === "row" ? "tasks-composer is-row" : "tasks-composer"
      }
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={titleRef}
        className="tasks-composer-title"
        value={draft.title}
        onChange={(e) => onChange({ title: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Task name"
        aria-label="Task name"
      />
      <div className="tasks-composer-bar">
        <div className="tasks-composer-chips">
          <TasksComposerPicker
            aria-label="List"
            value={currentList}
            display={currentList}
            options={listOptions}
            searchable
            searchPlaceholder="Filter lists…"
            onChange={(v) => onChange({ list: v })}
          />
          <TasksDateField
            variant="chip"
            value={draft.due || null}
            onChange={(due) => onChange({ due: due ?? "" })}
          />
          <TasksPriorityPicker
            value={draft.priority}
            onChange={(priority) => onChange({ priority })}
          />
          <TagChipsInput
            className="tasks-composer-labels"
            tags={draft.labels}
            onChange={(labels) => onChange({ labels })}
            catalog={labelCatalog}
            pastelChips
            portalPopover
            placeholder="Labels"
            ariaLabel="Labels"
            onEmptyEnter={onSubmit}
          />
        </div>
        <div className="tasks-composer-actions">
          <button
            type="button"
            className="tasks-icon-btn"
            title="Cancel"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="tasks-composer-submit"
            title={submitLabel}
            aria-label={submitLabel}
            onClick={onSubmit}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.2 8.2 6.5 11.4 12.8 4.6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

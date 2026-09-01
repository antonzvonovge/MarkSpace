import { useEffect, useRef, type FocusEvent, type RefObject } from "react";
import type { TaskPriority } from "../../lib/taskNotes";
import { syncAutosizeTextarea } from "../../lib/autosizeTextarea";
import { TagChipsInput } from "../TagChipsInput";
import { TasksComposerPicker } from "./TasksComposerPicker";
import { TasksDateField } from "./TasksDateField";
import { TasksPriorityPicker } from "./TasksPriorityPicker";

const COMPOSER_KEEP_FOCUS_SELECTOR =
  ".tasks-composer-picker-menu, .tasks-date-panel, .tasks-priority-menu, .tag-chips-input-portal";

export function isTasksComposerDraftEmpty(draft: TasksComposerDraft): boolean {
  return !draft.title.trim();
}

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
  titleRef?: RefObject<HTMLTextAreaElement | null>;
  /** `row` replaces a task line; `footer` is the add-task composer. */
  variant?: "footer" | "row";
  submitLabel?: string;
  onChange: (patch: Partial<TasksComposerDraft>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Hide the composer when focus leaves and the title is still empty. */
  onBlurEmpty?: () => void;
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
  onBlurEmpty,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const internalTitleRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = titleRef ?? internalTitleRef;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const ignoreBlurUntilRef = useRef(0);

  useEffect(() => {
    ignoreBlurUntilRef.current = performance.now() + 150;
  }, []);

  useEffect(() => {
    syncAutosizeTextarea(textareaRef.current);
  }, [draft.title, textareaRef]);

  const handleBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!onBlurEmpty) return;
    const next = e.relatedTarget;
    window.setTimeout(() => {
      if (performance.now() < ignoreBlurUntilRef.current) return;
      if (!rootRef.current?.isConnected) return;
      const active = document.activeElement;
      if (active && rootRef.current.contains(active)) return;
      if (active?.closest(COMPOSER_KEEP_FOCUS_SELECTOR)) return;
      if (next instanceof Node && rootRef.current.contains(next)) return;
      if (next instanceof Element && next.closest(COMPOSER_KEEP_FOCUS_SELECTOR)) {
        return;
      }
      if (isTasksComposerDraftEmpty(draftRef.current)) onBlurEmpty();
    }, 0);
  };

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
      ref={rootRef}
      className={
        variant === "row" ? "tasks-composer is-row" : "tasks-composer"
      }
      onClick={(e) => e.stopPropagation()}
      onBlurCapture={handleBlurCapture}
    >
      <textarea
        ref={textareaRef}
        className="tasks-composer-title"
        value={draft.title}
        rows={1}
        onChange={(e) => {
          onChange({ title: e.target.value });
          syncAutosizeTextarea(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Task name"
        aria-label="Task name"
      />
      <div className="tasks-composer-bar">
        <div className="tasks-composer-chips">
          <span className="tasks-composer-chip-slot">
            <TasksComposerPicker
              aria-label="List"
              value={currentList}
              display={currentList}
              options={listOptions}
              searchable
              searchPlaceholder="Filter lists…"
              onChange={(v) => onChange({ list: v })}
            />
          </span>
          <span className="tasks-composer-chip-slot">
            <TasksDateField
              variant="chip"
              value={draft.due || null}
              onChange={(due) => onChange({ due: due ?? "" })}
            />
          </span>
          <span className="tasks-composer-chip-slot">
            <TasksPriorityPicker
              value={draft.priority}
              onChange={(priority) => onChange({ priority })}
            />
          </span>
          <span className="tasks-composer-chip-slot tasks-composer-chip-slot-grow">
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
          </span>
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

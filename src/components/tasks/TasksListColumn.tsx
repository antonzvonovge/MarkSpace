import { memo, type ReactNode, type RefObject } from "react";
import type { TaskIndexEntry, TaskPriority, TasksViewId } from "../../lib/taskNotes";
import type { TreeNode } from "../../lib/vaultApi";
import { Select } from "../ui/Select";
import {
  TasksComposer,
  type TasksComposerDraft,
} from "./TasksComposer";
import { TasksSortableTree } from "./tree/TasksSortableTree";
import type {
  TaskTreeActions,
  TaskTreeEditState,
} from "./tree/TaskTreeActionsContext";
import {
  TasksIconAddPlusActive,
  TasksIconAddPlusIdle,
} from "./tasksIcons";
import { TASK_PRIORITY_OPTIONS } from "../../lib/taskPriorities";

export type TasksListFilters = {
  list: string;
  priority: TaskPriority | "";
  label: string;
  query: string;
  status: "open" | "done" | "all";
};

export const TasksListColumn = memo(function TasksListColumn({
  viewTitle,
  view,
  filters,
  patchFilters,
  labels,
  lists,
  listColors,
  loading,
  entriesLength,
  visible,
  emptyMessage,
  adding,
  expanded,
  selectedPath,
  treeSortable,
  vaultTree,
  treeActions,
  treeEdit,
  completingPaths,
  todayYmd,
  quickDraft,
  titleRef,
  onExpandPath,
  onPersisted,
  onPatchQuickDraft,
  onSubmitQuickAdd,
  onCancelQuickAdd,
  onStartAdding,
}: {
  viewTitle: string;
  view: TasksViewId;
  filters: TasksListFilters;
  patchFilters: (patch: Partial<TasksListFilters>) => void;
  labels: string[];
  lists: string[];
  listColors: Record<string, string>;
  loading: boolean;
  entriesLength: number;
  visible: readonly TaskIndexEntry[];
  emptyMessage: string;
  adding: boolean;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  treeSortable: boolean;
  vaultTree: TreeNode | null | undefined;
  treeActions: TaskTreeActions;
  treeEdit: TaskTreeEditState | null;
  completingPaths: ReadonlySet<string>;
  todayYmd: string;
  quickDraft: TasksComposerDraft;
  titleRef: RefObject<HTMLInputElement | null>;
  onExpandPath: (path: string) => void;
  onPersisted: () => void | Promise<void>;
  onPatchQuickDraft: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitQuickAdd: () => void;
  onCancelQuickAdd: () => void;
  onStartAdding: () => void;
}): ReactNode {
  return (
    <div className="tasks-list-column">
      <header className="tasks-view-header">
        <h1 className="tasks-view-title">{viewTitle}</h1>
        {view === "filters" ? (
          <div className="tasks-view-filters">
            <Select
              aria-label="Project"
              value={filters.list}
              options={[
                { value: "", label: "Any project" },
                { value: "Inbox", label: "Inbox" },
                ...lists
                  .filter((l) => l !== "Inbox")
                  .map((l) => ({
                    value: l,
                    label: l,
                    color: listColors[l] || undefined,
                  })),
              ]}
              onChange={(v) => patchFilters({ list: v })}
            />
            <Select
              aria-label="Priority"
              value={filters.priority === "" ? "" : String(filters.priority)}
              options={[
                { value: "", label: "Any priority" },
                ...TASK_PRIORITY_OPTIONS.map((o) => ({
                  value: String(o.value),
                  label: o.label,
                })),
              ]}
              onChange={(v) =>
                patchFilters({
                  priority:
                    v === "1" || v === "2" || v === "3" || v === "4"
                      ? (Number(v) as TaskPriority)
                      : "",
                })
              }
            />
            <Select
              aria-label="Label"
              value={filters.label}
              options={[
                { value: "", label: "Any label" },
                ...labels.map((l) => ({ value: l, label: l })),
              ]}
              onChange={(v) => patchFilters({ label: v })}
            />
            <Select
              aria-label="Status"
              value={filters.status}
              options={[
                { value: "open", label: "Open" },
                { value: "done", label: "Done" },
                { value: "all", label: "All statuses" },
              ]}
              onChange={(v) =>
                patchFilters({
                  status:
                    v === "done" || v === "all" || v === "open" ? v : "open",
                })
              }
            />
          </div>
        ) : null}
      </header>

      <div className="tasks-list-scroll">
        {loading && entriesLength === 0 ? (
          <p className="tasks-empty">Loading…</p>
        ) : visible.length === 0 && !adding ? (
          <p className="tasks-empty">{emptyMessage}</p>
        ) : (
          <TasksSortableTree
            entries={visible}
            expanded={expanded}
            selectedPath={selectedPath}
            sortable={treeSortable}
            vaultTree={vaultTree}
            actions={treeActions}
            edit={treeEdit}
            completingPaths={completingPaths}
            todayYmd={todayYmd}
            onExpandPath={onExpandPath}
            onPersisted={onPersisted}
          />
        )}

        {adding ? (
          <TasksComposer
            draft={quickDraft}
            lists={lists}
            listColors={listColors}
            labelCatalog={labels}
            titleRef={titleRef}
            submitLabel="Add task"
            onChange={onPatchQuickDraft}
            onSubmit={onSubmitQuickAdd}
            onCancel={onCancelQuickAdd}
          />
        ) : (
          <button
            type="button"
            className="tasks-add-trigger"
            onClick={onStartAdding}
          >
            <span className="tasks-add-icon" aria-hidden="true">
              <TasksIconAddPlusIdle
                className="tasks-add-icon-idle"
                size={18}
              />
              <TasksIconAddPlusActive
                className="tasks-add-icon-active"
                size={18}
              />
            </span>
            Add task
          </button>
        )}
      </div>
    </div>
  );
});

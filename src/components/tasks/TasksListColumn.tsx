import { memo, useCallback, type ReactNode, type RefObject } from "react";
import type { TaskIndexEntry, TaskPriority, TasksViewId } from "../../lib/taskNotes";
import { pastelChipStyle } from "../../lib/pastelChipColors";
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
  labels: string[];
  unlabeledOnly: boolean;
  query: string;
  status: "open" | "done" | "all";
};

function labelSelected(selected: readonly string[], name: string): boolean {
  const key = name.trim().toLowerCase();
  return selected.some((l) => l.trim().toLowerCase() === key);
}

export const TasksListColumn = memo(function TasksListColumn({
  viewTitle,
  view,
  filters,
  patchFilters,
  labels,
  filterLabelCatalog,
  hasUnlabeledInView,
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
  onDropOnList,
  onPatchQuickDraft,
  onSubmitQuickAdd,
  onCancelQuickAdd,
  onStartAdding,
  addComposerParentPath = null,
  addDraft,
  addTitleRef,
  onPatchAddDraft,
  onSubmitAddSubtask,
  onCancelAddSubtask,
  onStartAddSubtask,
}: {
  viewTitle: string;
  view: TasksViewId;
  filters: TasksListFilters;
  patchFilters: (patch: Partial<TasksListFilters>) => void;
  labels: string[];
  /** Labels present on tasks in the current view (before label filter). */
  filterLabelCatalog: string[];
  /** Whether the current view has any task with no labels. */
  hasUnlabeledInView: boolean;
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
  titleRef: RefObject<HTMLTextAreaElement | null>;
  onExpandPath: (path: string) => void;
  onPersisted: () => void | Promise<void>;
  onDropOnList?: (path: string, list: string) => void | Promise<void>;
  onPatchQuickDraft: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitQuickAdd: () => void;
  onCancelQuickAdd: () => void;
  onStartAdding: () => void;
  addComposerParentPath?: string | null;
  addDraft?: TasksComposerDraft;
  addTitleRef?: RefObject<HTMLTextAreaElement | null>;
  onPatchAddDraft?: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitAddSubtask?: (parentPath: string) => void;
  onCancelAddSubtask?: () => void;
  onStartAddSubtask?: (parentPath: string) => void;
}): ReactNode {
  const showListChip =
    view === "today" ||
    view === "overdue" ||
    (view === "filters" && !filters.list.trim());

  const showLabelFilter =
    filterLabelCatalog.length > 0 ||
    hasUnlabeledInView ||
    filters.labels.length > 0 ||
    filters.unlabeledOnly;

  const toggleLabel = useCallback(
    (name: string) => {
      const on = labelSelected(filters.labels, name);
      if (on) {
        patchFilters({
          labels: filters.labels.filter(
            (l) => l.trim().toLowerCase() !== name.trim().toLowerCase(),
          ),
        });
        return;
      }
      patchFilters({
        unlabeledOnly: false,
        labels: [...filters.labels, name],
      });
    },
    [filters.labels, patchFilters],
  );

  const toggleUnlabeled = useCallback(() => {
    if (filters.unlabeledOnly) {
      patchFilters({ unlabeledOnly: false });
      return;
    }
    patchFilters({ unlabeledOnly: true, labels: [] });
  }, [filters.unlabeledOnly, patchFilters]);

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
        {showLabelFilter ? (
          <div
            className="tasks-view-label-filter"
            role="group"
            aria-label="Filter by labels"
          >
            {hasUnlabeledInView || filters.unlabeledOnly ? (
              <button
                type="button"
                className={
                  filters.unlabeledOnly
                    ? "tasks-label-filter-chip is-active is-unlabeled"
                    : "tasks-label-filter-chip is-unlabeled"
                }
                aria-pressed={filters.unlabeledOnly}
                onClick={toggleUnlabeled}
              >
                No labels
              </button>
            ) : null}
            {filterLabelCatalog.map((name) => {
              const active =
                !filters.unlabeledOnly && labelSelected(filters.labels, name);
              return (
                <button
                  key={name}
                  type="button"
                  className={
                    active
                      ? "tasks-label-filter-chip is-active"
                      : "tasks-label-filter-chip"
                  }
                  style={pastelChipStyle(name)}
                  aria-pressed={active}
                  onClick={() => toggleLabel(name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ) : null}
      </header>

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
            showListChip={showListChip}
            listColors={listColors}
            onExpandPath={onExpandPath}
            onPersisted={onPersisted}
            onDropOnList={onDropOnList}
            addComposerParentPath={addComposerParentPath}
            addDraft={addDraft ?? quickDraft}
            addTitleRef={addTitleRef ?? titleRef}
            addLists={lists}
            addListColors={listColors}
            addLabelCatalog={labels}
            onPatchAddDraft={onPatchAddDraft ?? onPatchQuickDraft}
            onSubmitAddSubtask={onSubmitAddSubtask}
            onCancelAddSubtask={onCancelAddSubtask}
            onStartAddSubtask={onStartAddSubtask}
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
            onBlurEmpty={onCancelQuickAdd}
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
  );
});

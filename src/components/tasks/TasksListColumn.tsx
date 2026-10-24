import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { TaskIndexEntry, TaskPriority, TasksViewId } from "../../lib/taskNotes";
import { pastelChipStyle } from "../../lib/pastelChipColors";
import type { TreeNode } from "../../lib/vaultApi";
import { Select } from "../ui/Select";
import {
  TasksComposer,
  type TasksComposerDraft,
} from "./TasksComposer";
import { TasksSortableTree } from "./tree/TasksSortableTree";
import { TASK_GROUP_DROP_ATTR } from "./tree/taskGroupDropTarget";
import type {
  TaskTreeActions,
  TaskTreeEditState,
} from "./tree/TaskTreeActionsContext";
import {
  TasksIconAddPlusActive,
  TasksIconAddPlusIdle,
} from "./tasksIcons";
import { TASK_PRIORITY_OPTIONS } from "../../lib/taskPriorities";
import {
  groupByOptions,
  parseTaskGroupBy,
  partitionTasksByGroup,
  type TaskGroupBy,
} from "../../lib/taskGrouping";
import {
  loadTasksListGroupSectionsCollapsed,
  saveTasksListGroupSectionsCollapsed,
  tasksListContextKey,
} from "../../lib/tasksUiState";
import { useTasksPanelStore } from "../../store/tasksPanelStore";

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

function AddTaskTrigger({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <button type="button" className="tasks-add-trigger" onClick={onClick}>
      <span className="tasks-add-icon" aria-hidden="true">
        <TasksIconAddPlusIdle className="tasks-add-icon-idle" size={18} />
        <TasksIconAddPlusActive className="tasks-add-icon-active" size={18} />
      </span>
      Add task
    </button>
  );
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
  addingSectionId = null,
  groupBy,
  onGroupByChange,
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
  onDropOnGroup,
  onPatchQuickDraft,
  onSubmitQuickAdd,
  onCancelQuickAdd,
  onStartAdding,
  onStartAddingInSection,
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
  /** Section id when adding via a grouped Add task control. */
  addingSectionId?: string | null;
  groupBy: TaskGroupBy;
  onGroupByChange: (next: TaskGroupBy) => void;
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
  onDropOnGroup?: (path: string, sectionId: string) => void | Promise<void>;
  onPatchQuickDraft: (patch: Partial<TasksComposerDraft>) => void;
  onSubmitQuickAdd: () => void;
  onCancelQuickAdd: () => void;
  onStartAdding: () => void;
  onStartAddingInSection: (sectionId: string) => void;
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

  const grouped = groupBy !== "none";
  const contextKey = tasksListContextKey(view, filters.list);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => new Set(loadTasksListGroupSectionsCollapsed(contextKey)),
  );
  const taskGroupDropTarget = useTasksPanelStore((s) => s.taskGroupDropTarget);

  useEffect(() => {
    setCollapsedSections(
      new Set(loadTasksListGroupSectionsCollapsed(contextKey)),
    );
  }, [contextKey]);

  const toggleSectionCollapsed = useCallback(
    (sectionId: string) => {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        saveTasksListGroupSectionsCollapsed(contextKey, [...next]);
        return next;
      });
    },
    [contextKey],
  );

  const sections = useMemo(() => {
    if (!grouped) return null;
    const all = partitionTasksByGroup(visible, {
      groupBy,
      today: todayYmd,
      labelCatalog: filterLabelCatalog,
      listCatalog: lists,
    });
    // Hide empty sections; keep the one currently used for Add.
    return all.filter(
      (s) => s.items.length > 0 || s.id === (addingSectionId ?? ""),
    );
  }, [
    addingSectionId,
    filterLabelCatalog,
    groupBy,
    grouped,
    lists,
    todayYmd,
    visible,
  ]);

  const groupBySelectOptions = useMemo(
    () => groupByOptions(view, filters.list),
    [filters.list, view],
  );

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

  const treeShared = {
    expanded,
    selectedPath,
    sortable: treeSortable,
    vaultTree,
    actions: treeActions,
    edit: treeEdit,
    completingPaths,
    todayYmd,
    showListChip,
    listColors,
    onExpandPath,
    onPersisted,
    onDropOnList,
    onDropOnGroup,
    addComposerParentPath,
    addDraft: addDraft ?? quickDraft,
    addTitleRef: addTitleRef ?? titleRef,
    addLists: lists,
    addListColors: listColors,
    addLabelCatalog: labels,
    onPatchAddDraft: onPatchAddDraft ?? onPatchQuickDraft,
    onSubmitAddSubtask,
    onCancelAddSubtask,
    onStartAddSubtask,
  };

  const showEmpty =
    !loading &&
    visible.length === 0 &&
    !adding &&
    !addingSectionId;

  return (
    <div className="tasks-list-column">
      <header className="tasks-view-header">
        <div className="tasks-view-title-row">
          <h1 className="tasks-view-title">{viewTitle}</h1>
          <Select
            aria-label="Group by"
            value={groupBy}
            options={groupBySelectOptions}
            onChange={(v) => onGroupByChange(parseTaskGroupBy(v))}
          />
        </div>
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
      ) : showEmpty ? (
        <p className="tasks-empty">{emptyMessage}</p>
      ) : grouped && sections && sections.length > 0 ? (
        <div className="tasks-group-sections">
          {sections.map((section) => {
            const collapsed = collapsedSections.has(section.id);
            const isDropTarget = taskGroupDropTarget === section.id;
            const sectionAdding = addingSectionId === section.id;
            const rootCount = section.items.filter((e) => {
              if (!e.parent) return true;
              return !section.items.some((x) => x.id === e.parent);
            }).length;
            return (
              <section
                key={section.id}
                className={
                  isDropTarget
                    ? "tasks-group-section is-drop-target"
                    : "tasks-group-section"
                }
                {...{ [TASK_GROUP_DROP_ATTR]: section.id }}
              >
                <button
                  type="button"
                  className="tasks-group-section-header"
                  aria-expanded={!collapsed}
                  onClick={() => toggleSectionCollapsed(section.id)}
                >
                  <svg
                    className={
                      collapsed
                        ? "tasks-group-section-chevron"
                        : "tasks-group-section-chevron is-open"
                    }
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M6 3.75 10.25 8 6 12.25"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="tasks-group-section-title">
                    {section.label}
                  </span>
                  <span className="tasks-group-section-count">{rootCount}</span>
                </button>
                {!collapsed ? (
                  <>
                    {section.items.length > 0 || sectionAdding ? (
                      <TasksSortableTree
                        {...treeShared}
                        entries={section.items}
                        groupSectionId={section.id}
                      />
                    ) : null}
                    {sectionAdding ? (
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
                      <AddTaskTrigger
                        onClick={() => onStartAddingInSection(section.id)}
                      />
                    )}
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <TasksSortableTree {...treeShared} entries={visible} />
      )}

      {!grouped || showEmpty || (sections != null && sections.length === 0) ? (
        adding ? (
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
          <AddTaskTrigger onClick={onStartAdding} />
        )
      ) : null}
    </div>
  );
});

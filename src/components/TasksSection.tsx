import { useCallback, useMemo, useState, type ReactNode } from "react";
import { PromptDialog } from "./AppDialog";
import {
  PlusIcon,
  TasksFiltersIcon,
  TasksInboxIcon,
  TasksListIcon,
  TasksSectionIcon,
  TasksTodayIcon,
} from "./treeIcons";
import { createTaskList, collectTaskLists, type TasksViewId } from "../lib/taskNotes";
import {
  loadTasksSectionCollapsed,
  saveTasksSectionCollapsed,
} from "../lib/tasksUiState";
import { useTasksPanelStore } from "../store/tasksPanelStore";
import { TASKS_TAB_PATH, useVaultStore } from "../store/vaultStore";

const SMART_VIEWS: {
  id: TasksViewId;
  label: string;
  icon: ReactNode;
}[] = [
  { id: "inbox", label: "Inbox", icon: <TasksInboxIcon /> },
  { id: "today", label: "Today", icon: <TasksTodayIcon /> },
  { id: "filters", label: "Filters", icon: <TasksFiltersIcon /> },
];

function InboxChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? "tasks-section-chevron is-open" : "tasks-section-chevron"}
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
  );
}

export function TasksSection() {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const openTasksTab = useVaultStore((s) => s.openTasksTab);
  const activePath = useVaultStore((s) => s.activePath);
  const view = useTasksPanelStore((s) => s.view);
  const filters = useTasksPanelStore((s) => s.filters);
  const setView = useTasksPanelStore((s) => s.setView);
  const patchFilters = useTasksPanelStore((s) => s.patchFilters);
  const [collapsed, setCollapsed] = useState(() => loadTasksSectionCollapsed());
  const [createOpen, setCreateOpen] = useState(false);
  const tasksTabActive = activePath === TASKS_TAB_PATH;

  const lists = useMemo(
    () => collectTaskLists(tree).filter((l) => l !== "Inbox"),
    [tree],
  );

  const openSmartView = useCallback(
    (next: TasksViewId) => {
      patchFilters({
        list: "",
        priority: "",
        label: "",
        query: "",
        status: "open",
      });
      setView(next);
      void openTasksTab({ syncTreeSelection: false });
    },
    [openTasksTab, patchFilters, setView],
  );

  const openList = useCallback(
    (list: string) => {
      patchFilters({
        list,
        priority: "",
        label: "",
        query: "",
        status: "open",
      });
      setView("all");
      void openTasksTab({ syncTreeSelection: false });
    },
    [openTasksTab, patchFilters, setView],
  );

  const onCreateList = useCallback(
    async (raw: string) => {
      setCreateOpen(false);
      try {
        const name = await createTaskList(raw);
        await refreshTree();
        openList(name);
      } catch (e) {
        console.error(e);
      }
    },
    [openList, refreshTree],
  );

  return (
    <div className="tasks-section">
      <div className="tasks-section-header">
        <button
          type="button"
          className="tasks-section-title-btn"
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            saveTasksSectionCollapsed(next);
          }}
        >
          <span className="tasks-section-chevron-slot" aria-hidden="true">
            <InboxChevron open={!collapsed} />
          </span>
          <span className="tasks-section-header-icon" aria-hidden="true">
            <TasksSectionIcon />
          </span>
          <span className="tasks-section-title">Tasks</span>
        </button>
        <div className="section-header-actions">
          <button
            type="button"
            className="tree-toolbar-btn"
            title="New list"
            aria-label="New list"
            onClick={(e) => {
              e.stopPropagation();
              setCreateOpen(true);
            }}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
      {!collapsed ? (
        <ul className="tasks-section-list" role="list">
          {SMART_VIEWS.map((v) => {
            const selected =
              tasksTabActive && view === v.id && !filters.list;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className={
                    selected
                      ? "tasks-section-row is-selected"
                      : "tasks-section-row"
                  }
                  onClick={() => openSmartView(v.id)}
                >
                  <span className="tasks-section-row-icon" aria-hidden="true">
                    {v.icon}
                  </span>
                  <span className="tasks-section-row-label">{v.label}</span>
                </button>
              </li>
            );
          })}
          {lists.length > 0 ? (
            <li className="tasks-section-sep" aria-hidden="true" />
          ) : null}
          {lists.map((list) => {
            const selected =
              tasksTabActive && filters.list === list && view === "all";
            return (
              <li key={`list:${list}`}>
                <button
                  type="button"
                  className={
                    selected
                      ? "tasks-section-row is-selected"
                      : "tasks-section-row"
                  }
                  onClick={() => openList(list)}
                >
                  <span className="tasks-section-row-icon" aria-hidden="true">
                    <TasksListIcon />
                  </span>
                  <span className="tasks-section-row-label">{list}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <PromptDialog
        open={createOpen}
        title="New list"
        description="Create a folder under Tasks for this list."
        label="List name"
        defaultValue=""
        confirmLabel="Create"
        onCancel={() => setCreateOpen(false)}
        onConfirm={(value) => {
          void onCreateList(value);
        }}
      />
    </div>
  );
}

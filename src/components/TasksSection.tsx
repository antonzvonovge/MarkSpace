import { useCallback, useState } from "react";
import { loadTasksSectionCollapsed, saveTasksSectionCollapsed } from "../lib/tasksUiState";
import type { TasksViewId } from "../lib/taskNotes";
import { useTasksPanelStore } from "../store/tasksPanelStore";
import { TASKS_TAB_PATH, useVaultStore } from "../store/vaultStore";
import { TasksSectionIcon } from "./treeIcons";

const VIEWS: { id: TasksViewId; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "all", label: "All" },
  { id: "filters", label: "Filters" },
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
  const openTasksTab = useVaultStore((s) => s.openTasksTab);
  const activePath = useVaultStore((s) => s.activePath);
  const view = useTasksPanelStore((s) => s.view);
  const setView = useTasksPanelStore((s) => s.setView);
  const [collapsed, setCollapsed] = useState(() => loadTasksSectionCollapsed());
  const tasksTabActive = activePath === TASKS_TAB_PATH;

  const openView = useCallback(
    (next: TasksViewId) => {
      setView(next);
      void openTasksTab({ syncTreeSelection: false });
    },
    [openTasksTab, setView],
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
      </div>
      {!collapsed ? (
        <ul className="tasks-section-list" role="list">
          {VIEWS.map((v) => {
            const selected = tasksTabActive && view === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className={
                    selected ? "tasks-section-row is-selected" : "tasks-section-row"
                  }
                  onClick={() => openView(v.id)}
                >
                  {v.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

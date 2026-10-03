import { useEffect, type ReactNode } from "react";
import {
  AlarmClock,
  Calendar,
  ChartHistogram,
  Comment,
  FolderClose,
  ListCheckbox,
  Tag,
} from "@icon-park/react";
import { useSidebarUiStore, type SidebarPane } from "../../store/sidebarUiStore";
import { useTaskListCountsStore } from "../../store/taskListCountsStore";
import { useTasksPanelStore } from "../../store/tasksPanelStore";
import { TASKS_TAB_PATH, useVaultStore } from "../../store/vaultStore";

const paneIcon = {
  theme: "two-tone" as const,
  size: 28,
  strokeWidth: 3,
  fill: ["var(--pane-icon-stroke)", "var(--pane-icon-fill)"] as [string, string],
};

const PANES: readonly { id: SidebarPane; label: string; icon: ReactNode }[] = [
  { id: "files", label: "Files", icon: <FolderClose {...paneIcon} /> },
  { id: "tags", label: "Tags", icon: <Tag {...paneIcon} /> },
  { id: "tasks", label: "Tasks", icon: <ListCheckbox {...paneIcon} /> },
  { id: "routines", label: "Routines", icon: <AlarmClock {...paneIcon} /> },
  { id: "comments", label: "Comments", icon: <Comment {...paneIcon} /> },
  { id: "dashboards", label: "Dashboards", icon: <ChartHistogram {...paneIcon} /> },
];

/** Pane switcher plus task-count sync that must run even when Tasks is unmounted. */
export function SidebarPaneTabs() {
  const pane = useSidebarUiStore((s) => s.sidebarPane);
  const setSidebarPane = useSidebarUiStore((s) => s.setSidebarPane);
  const calendarOpen = useSidebarUiStore((s) => s.calendarOpen);
  const toggleCalendar = useSidebarUiStore((s) => s.toggleCalendar);
  const tree = useVaultStore((s) => s.tree);
  const tasksPanelOpen = useVaultStore((s) => s.activePath === TASKS_TAB_PATH);
  const view = useTasksPanelStore((s) => s.view);
  const filters = useTasksPanelStore((s) => s.filters);
  const overdue = useTaskListCountsStore((s) => s.counts.overdue.overdue);
  const openComments = useVaultStore((s) => {
    let count = 0;
    for (const ref of s.allComments) {
      if (!ref.comment.resolved) count += 1;
    }
    return count;
  });

  useEffect(() => {
    if (tasksPanelOpen) return;
    void useTaskListCountsStore.getState().syncFromTree(tree);
  }, [tree, tasksPanelOpen]);

  useEffect(() => {
    useTaskListCountsStore.getState().recompute();
  }, [view, filters]);

  return (
    <div className="sidebar-pane-switch">
      <div className="sidebar-pane-switch-tabs" role="tablist" aria-label="Sidebar">
      {PANES.map((item) => {
        const selected = pane === item.id;
        const taskOverdue = item.id === "tasks" ? overdue : 0;
        const commentBadge = item.id === "comments" ? openComments : 0;
        const label =
          item.id === "tasks" && overdue > 0
            ? `Tasks, ${overdue} overdue`
            : item.id === "comments" && openComments > 0
              ? `Comments, ${openComments} open`
              : item.label;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`sidebar-pane-tab-${item.id}`}
            className={
              selected
                ? "sidebar-pane-switch-btn is-active"
                : "sidebar-pane-switch-btn"
            }
            aria-selected={selected}
            aria-controls="sidebar-pane"
            aria-label={label}
            title={label}
            onClick={() => {
              if (!selected) setSidebarPane(item.id);
            }}
          >
            {item.icon}
            {taskOverdue > 0 ? (
              <span className="sidebar-pane-switch-badge is-count" aria-hidden="true">
                {taskOverdue > 99 ? "99+" : taskOverdue}
              </span>
            ) : null}
            {commentBadge > 0 ? (
              <span className="sidebar-pane-switch-badge" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
      </div>
      <button
        type="button"
        className={
          calendarOpen
            ? "sidebar-pane-switch-btn is-active"
            : "sidebar-pane-switch-btn"
        }
        aria-label={calendarOpen ? "Close calendar" : "Open calendar"}
        aria-pressed={calendarOpen}
        title="Calendar"
        onClick={() => toggleCalendar()}
      >
        <Calendar {...paneIcon} />
      </button>
    </div>
  );
}

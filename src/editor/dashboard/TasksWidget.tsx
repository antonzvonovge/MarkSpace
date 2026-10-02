import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskDetailPanel } from "../../components/TasksView";
import {
  collectTaskLabels,
  collectTaskLists,
  completeTask,
  localDateYmd,
  type TaskIndexEntry,
  type TaskPriority,
} from "../../lib/taskNotes";
import type { TasksWidgetSource } from "../../lib/dashboardFormat";
import { openTaskListRows, openTaskViewRows } from "../../lib/taskListRows";
import { buildTaskListSidebar, taskListColor } from "../../lib/taskListMeta";
import { useTaskListMetaStore } from "../../store/taskListMetaStore";
import { useVaultStore } from "../../store/vaultStore";
import { TaskMetaLine } from "../../components/tasks/TaskMetaLine";
import { useDashboardsLive } from "../../store/dashboardEnabledStore";
import { reloadTaskIndex, useTaskIndex } from "./taskIndex";
import { WidgetTasksIcon } from "./widgetIcons";

const INDENT = 28;

function priorityClass(priority: TaskPriority | null | undefined): string {
  if (priority == null) return "";
  return ` is-p${priority}`;
}

const CircleCheck = memo(function CircleCheck({
  checked,
  priority,
  onClick,
}: {
  checked: boolean;
  priority?: TaskPriority | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`tasks-circle${priorityClass(priority)}${checked ? " is-checked" : ""}`}
      title={checked ? "Completed" : "Mark done"}
      aria-label={checked ? "Completed" : "Mark done"}
      onClick={(event) => {
        event.stopPropagation();
        if (checked) return;
        onClick();
      }}
    >
      {checked ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </button>
  );
});

const TaskListRowView = memo(function TaskListRowView({
  entry,
  depth,
  completing,
  todayYmd,
  showList,
  listColor,
  onOpen,
  onComplete,
}: {
  entry: TaskIndexEntry;
  depth: number;
  completing: boolean;
  todayYmd: string;
  showList: boolean;
  listColor: string;
  onOpen: (path: string) => void;
  onComplete: (entry: TaskIndexEntry) => void;
}) {
  return (
    <li
      className="tasks-list-item"
      style={depth > 0 ? { paddingLeft: depth * INDENT } : undefined}
    >
      <div className="tasks-row" onClick={() => onOpen(entry.path)}>
        <div className="tasks-row-content">
          <CircleCheck
            checked={completing}
            priority={entry.priority}
            onClick={() => onComplete(entry)}
          />
          <div className="tasks-row-body">
            <span className="tasks-row-title">{entry.title}</span>
            <TaskMetaLine
              due={entry.due}
              labels={entry.labels}
              subtaskDone={entry.subtaskDone}
              subtaskTotal={entry.subtaskTotal}
              commentCount={entry.commentCount}
              todayYmd={todayYmd}
              list={entry.list || "Inbox"}
              listColor={listColor}
              showList={showList}
            />
          </div>
        </div>
      </div>
    </li>
  );
});

const VIRTUAL_VIEWS = [
  { view: "today", label: "Today" },
  { view: "overdue", label: "Overdue" },
] as const;

const ListPicker = memo(function ListPicker({
  names,
  onPick,
  onCancel,
}: {
  names: readonly string[];
  onPick: (source: TasksWidgetSource) => void;
  onCancel?: () => void;
}) {
  return (
    <div className="dashboard-tasks-pick">
      <div role="listbox" aria-label="Task lists">
        {VIRTUAL_VIEWS.map((item) => (
          <button
            key={item.view}
            type="button"
            className="dashboard-tasks-hit"
            onClick={() => onPick({ view: item.view })}
          >
            {item.label}
          </button>
        ))}
        {names.length > 0 ? <div className="dashboard-tasks-pick-rule" /> : null}
        {names.map((name) => (
          <button
            key={name}
            type="button"
            className="dashboard-tasks-hit"
            onClick={() => onPick({ list: name })}
          >
            {name}
          </button>
        ))}
      </div>
      {names.length === 0 ? (
        <p className="dashboard-widget-empty">No task lists yet</p>
      ) : null}
      {onCancel ? (
        <button type="button" className="dashboard-weather-cancel" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
});

export const TasksWidget = memo(function TasksWidget({
  list,
  view,
  onRemove,
  onSource,
}: {
  list: string;
  view?: "today" | "overdue";
  onRemove: () => void;
  onSource: (source: TasksWidgetSource) => void;
}) {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const live = useDashboardsLive();
  const { entries, loading, error } = useTaskIndex(live);
  const metaByName = useTaskListMetaStore((s) => s.metaByName);
  const groups = useTaskListMetaStore((s) => s.groups);
  const metaLoaded = useTaskListMetaStore((s) => s.loaded);
  const refreshMeta = useTaskListMetaStore((s) => s.refresh);
  const configured = Boolean(view) || list.length > 0;
  const [picking, setPicking] = useState(!configured);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [completing, setCompleting] = useState<ReadonlySet<string>>(() => new Set());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const busyRef = useRef(new Set<string>());
  const aliveRef = useRef(true);
  const today = localDateYmd();

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!live || metaLoaded) return;
    void refreshMeta();
  }, [live, metaLoaded, refreshMeta]);

  useEffect(() => {
    if (!view && list.length === 0) setPicking(true);
  }, [list, view]);

  const listNames = useMemo(() => {
    const names = collectTaskLists(tree);
    const { sections, ungrouped } = buildTaskListSidebar(names, groups, metaByName);
    return [
      ...sections.flatMap((section) => section.lists.map((item) => item.name)),
      ...ungrouped.map((item) => item.name),
    ];
  }, [tree, groups, metaByName]);

  const rows = useMemo(() => {
    const visible = view
      ? openTaskViewRows(entries, view, today)
      : openTaskListRows(entries, list);
    return visible.filter((row) => !hidden.has(row.entry.path));
  }, [entries, list, view, hidden, today]);

  const lists = useMemo(() => collectTaskLists(tree), [tree]);
  const listColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const name of lists) {
      const color = taskListColor(metaByName, name);
      if (color) out[name] = color;
    }
    return out;
  }, [lists, metaByName]);
  const labels = useMemo(() => collectTaskLabels(entries), [entries]);
  const listColor = list ? taskListColor(metaByName, list) : "";
  const openIndex = openPath ? rows.findIndex((row) => row.entry.path === openPath) : -1;

  const onOpen = useCallback((path: string) => setOpenPath(path), []);

  const onComplete = useCallback(
    (entry: TaskIndexEntry) => {
      if (!live || busyRef.current.has(entry.path)) return;
      const childPaths = entriesRef.current
        .filter(
          (item) =>
            item.parent === entry.id &&
            item.path !== entry.path &&
            item.status === "open",
        )
        .map((item) => item.path);
      const branch = [entry.path, ...childPaths];
      for (const path of branch) busyRef.current.add(path);
      setCompleting((prev) => {
        const next = new Set(prev);
        for (const path of branch) next.add(path);
        return next;
      });
      window.setTimeout(() => {
        if (aliveRef.current) {
          setHidden((prev) => {
            const next = new Set(prev);
            for (const path of branch) next.add(path);
            return next;
          });
          setOpenPath((current) => (current && branch.includes(current) ? null : current));
        }
        void (async () => {
          try {
            await completeTask(entry.path, {
              tree: useVaultStore.getState().tree,
              index: entriesRef.current,
            });
            await refreshTree();
          } catch (err) {
            console.error(err);
            if (!aliveRef.current) return;
            for (const path of branch) busyRef.current.delete(path);
            setHidden((prev) => {
              const next = new Set(prev);
              for (const path of branch) next.delete(path);
              return next;
            });
            setCompleting((prev) => {
              const next = new Set(prev);
              for (const path of branch) next.delete(path);
              return next;
            });
          }
        })();
      }, 200);
    },
    [live, refreshTree],
  );

  const title = view === "today" ? "Today" : view === "overdue" ? "Overdue" : list || "Tasks";
  const showList = Boolean(view);

  return (
    <article
      className="dashboard-widget is-tasks"
      style={listColor ? { borderLeftColor: listColor } : undefined}
    >
      <header className="dashboard-widget-handle">
        <span className="dashboard-widget-kind">
          <WidgetTasksIcon />
        </span>
        <span className="dashboard-widget-title">{title}</span>
        {configured && !picking ? (
          <button
            type="button"
            className="dashboard-widget-edit"
            onClick={(event) => {
              event.stopPropagation();
              setPicking(true);
            }}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="dashboard-widget-remove"
          aria-label="Remove widget"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </header>
      <div className="dashboard-widget-body is-tasks">
        {picking ? (
          <ListPicker
            names={listNames}
            onPick={(source) => {
              setPicking(false);
              onSource(source);
            }}
            onCancel={configured ? () => setPicking(false) : undefined}
          />
        ) : !live ? (
          <p className="dashboard-widget-empty">Paused</p>
        ) : error ? (
          <p className="dashboard-widget-empty">{error}</p>
        ) : loading && entries.length === 0 ? (
          <p className="dashboard-widget-empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="dashboard-widget-empty">No open tasks</p>
        ) : (
          <div className="dashboard-tasks">
            <ul className="tasks-list">
              {rows.map((row) => (
                <TaskListRowView
                  key={row.entry.path}
                  entry={row.entry}
                  depth={row.depth}
                  completing={completing.has(row.entry.path)}
                  todayYmd={today}
                  showList={showList}
                  listColor={listColors[row.entry.list || "Inbox"] ?? ""}
                  onOpen={onOpen}
                  onComplete={onComplete}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
      {live && openPath ? (
        <TaskDetailPanel
          path={openPath}
          entries={entries}
          lists={lists}
          listColors={listColors}
          labelCatalog={labels}
          onClose={() => setOpenPath(null)}
          onChanged={async () => {
            await refreshTree();
            await reloadTaskIndex();
          }}
          onOpenTask={(path) => setOpenPath(path)}
          onPrev={
            openIndex > 0
              ? () => setOpenPath(rows[openIndex - 1]!.entry.path)
              : undefined
          }
          onNext={
            openIndex >= 0 && openIndex < rows.length - 1
              ? () => setOpenPath(rows[openIndex + 1]!.entry.path)
              : undefined
          }
        />
      ) : null}
    </article>
  );
});

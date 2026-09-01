import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, PromptDialog } from "./AppDialog";
import {
  createTaskListWithSettings,
  saveTaskListProperties,
  TaskListPropertiesDialog,
} from "./TaskListPropertiesDialog";
import {
  PlusIcon,
  TasksFiltersIcon,
  TasksInboxIcon,
  TasksListIcon,
  TasksSectionIcon,
  TasksTodayIcon,
} from "./treeIcons";
import {
  buildTaskListSidebar,
  deleteTaskListGroup,
  taskListColor,
  taskListGroupId,
  upsertTaskListGroup,
  type SidebarListEntry,
} from "../lib/taskListMeta";
import { collectTaskLists, type TasksViewId } from "../lib/taskNotes";
import {
  loadTasksGroupsCollapsed,
  loadTasksSectionCollapsed,
  saveTasksGroupsCollapsed,
  saveTasksSectionCollapsed,
} from "../lib/tasksUiState";
import { TASKS_FOLDER, joinPath } from "../lib/vaultApi";
import { useTaskListMetaStore } from "../store/taskListMetaStore";
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

type ListMenuState = {
  x: number;
  y: number;
  listName: string;
};

type GroupMenuState = {
  x: number;
  y: number;
  groupId: string;
  groupName: string;
};

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

function ListIcon({ color }: { color: string }) {
  return (
    <span
      className={
        color
          ? "tasks-section-row-icon has-list-color"
          : "tasks-section-row-icon"
      }
      aria-hidden="true"
      style={
        color
          ? ({ ["--task-list-color"]: color } as CSSProperties)
          : undefined
      }
    >
      <TasksListIcon color={color || undefined} />
    </span>
  );
}

function TaskListContextMenu({
  menu,
  onClose,
  onRename,
  onSettings,
  onDelete,
}: {
  menu: ListMenuState;
  onClose: () => void;
  onRename: () => void;
  onSettings: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 180);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu is-plaintext"
      role="menu"
      style={{ position: "fixed", left, top, zIndex: 1100 }}
    >
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </button>
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onSettings();
        }}
      >
        List settings…
      </button>
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item is-danger"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        Delete
      </button>
    </div>,
    document.body,
  );
}

function TaskGroupContextMenu({
  menu,
  onClose,
  onRename,
  onDelete,
}: {
  menu: GroupMenuState;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 140);

  return createPortal(
    <div
      ref={menuRef}
      className="tree-context-menu is-plaintext"
      role="menu"
      style={{ position: "fixed", left, top, zIndex: 1100 }}
    >
      <button
        type="button"
        role="menuitem"
        className="tree-context-item"
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename
      </button>
      <div className="tree-context-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="tree-context-item is-danger"
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        Delete group
      </button>
    </div>,
    document.body,
  );
}

const ListRow = memo(function ListRow({
  entry,
  selected,
  onOpenList,
  onContextMenu,
}: {
  entry: SidebarListEntry;
  selected: boolean;
  onOpenList: (listName: string) => void;
  onContextMenu: (listName: string, x: number, y: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={
          selected ? "tasks-section-row is-selected" : "tasks-section-row"
        }
        onClick={() => onOpenList(entry.name)}
        onMouseDown={(e) => {
          if (e.button === 2) e.preventDefault();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(entry.name, e.clientX, e.clientY);
        }}
      >
        <ListIcon color={entry.color} />
        <span className="tasks-section-row-label">{entry.name}</span>
      </button>
    </li>
  );
});

const SmartViewRow = memo(function SmartViewRow({
  id,
  label,
  icon,
  selected,
  onOpen,
}: {
  id: TasksViewId;
  label: string;
  icon: ReactNode;
  selected: boolean;
  onOpen: (view: TasksViewId) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={
          selected ? "tasks-section-row is-selected" : "tasks-section-row"
        }
        onClick={() => onOpen(id)}
      >
        <span className="tasks-section-row-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="tasks-section-row-label">{label}</span>
      </button>
    </li>
  );
});

function effectiveTasksSidebarHighlight(
  highlight:
    | { kind: "view"; view: TasksViewId }
    | { kind: "list"; list: string }
    | null,
  tasksTabActive: boolean,
  view: TasksViewId,
  filterList: string,
):
  | { kind: "view"; view: TasksViewId }
  | { kind: "list"; list: string }
  | null {
  if (highlight) return highlight;
  if (!tasksTabActive) return null;
  if (filterList && view === "all") return { kind: "list", list: filterList };
  return { kind: "view", view };
}

export const TasksSection = memo(function TasksSection() {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const renameTreeEntry = useVaultStore((s) => s.renameTreeEntry);
  const removePath = useVaultStore((s) => s.removePath);
  const openTasksTab = useVaultStore((s) => s.openTasksTab);
  const activePath = useVaultStore((s) => s.activePath);
  const view = useTasksPanelStore((s) => s.view);
  const filterList = useTasksPanelStore((s) => s.filters.list);
  const sidebarHighlight = useTasksPanelStore((s) => s.sidebarHighlight);
  const setSidebarHighlight = useTasksPanelStore((s) => s.setSidebarHighlight);
  const setView = useTasksPanelStore((s) => s.setView);
  const patchFilters = useTasksPanelStore((s) => s.patchFilters);
  const groups = useTaskListMetaStore((s) => s.groups);
  const metaByName = useTaskListMetaStore((s) => s.metaByName);
  const refreshMeta = useTaskListMetaStore((s) => s.refresh);

  const [collapsed, setCollapsed] = useState(() => loadTasksSectionCollapsed());
  const [groupsCollapsed, setGroupsCollapsed] = useState(() =>
    loadTasksGroupsCollapsed(),
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [listMenu, setListMenu] = useState<ListMenuState | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [renameList, setRenameList] = useState<string | null>(null);
  const [renameGroup, setRenameGroup] = useState<GroupMenuState | null>(null);
  const [settingsList, setSettingsList] = useState<string | null>(null);
  const [deleteList, setDeleteList] = useState<string | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<GroupMenuState | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);

  const tasksTabActive = activePath === TASKS_TAB_PATH;

  const effectiveHighlight = useMemo(
    () =>
      effectiveTasksSidebarHighlight(
        sidebarHighlight,
        tasksTabActive,
        view,
        filterList,
      ),
    [sidebarHighlight, tasksTabActive, view, filterList],
  );

  const listNames = useMemo(
    () => collectTaskLists(tree).filter((l) => l !== "Inbox"),
    [tree],
  );

  const sidebar = useMemo(
    () => buildTaskListSidebar(listNames, groups, metaByName),
    [listNames, groups, metaByName],
  );

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta, tree]);

  const openSmartView = useCallback(
    (next: TasksViewId) => {
      setSidebarHighlight({ kind: "view", view: next });
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
    [openTasksTab, patchFilters, setSidebarHighlight, setView],
  );

  const openList = useCallback(
    (list: string) => {
      setSidebarHighlight({ kind: "list", list });
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
    [openTasksTab, patchFilters, setSidebarHighlight, setView],
  );

  const onCreateList = useCallback(
    async (value: {
      name: string;
      groupId: string;
      color: string;
      newGroupName?: string;
    }) => {
      setCreateSaving(true);
      try {
        const name = await createTaskListWithSettings(value, groups);
        await refreshTree();
        await refreshMeta();
        setCreateOpen(false);
        openList(name);
      } catch (e) {
        console.error(e);
      } finally {
        setCreateSaving(false);
      }
    },
    [groups, openList, refreshMeta, refreshTree],
  );

  const renameListFolder = useCallback(
    async (fromName: string, toName: string) => {
      const from = joinPath(TASKS_FOLDER, fromName);
      const nextPath = await renameTreeEntry(from, toName);
      if (!nextPath) return null;
      await refreshTree();
      await refreshMeta();
      if (filterList === fromName) {
        patchFilters({ list: toName });
      }
      return toName;
    },
    [filterList, patchFilters, refreshMeta, refreshTree, renameTreeEntry],
  );

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setGroupsCollapsed((prev) => {
      const next = prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId];
      saveTasksGroupsCollapsed(next);
      return next;
    });
  }, []);

  const handleListContextMenu = useCallback(
    (listName: string, x: number, y: number) => {
      setSidebarHighlight({ kind: "list", list: listName });
      setListMenu({ x, y, listName });
    },
    [setSidebarHighlight],
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
          {SMART_VIEWS.map((v) => (
            <SmartViewRow
              key={v.id}
              id={v.id}
              label={v.label}
              icon={v.icon}
              selected={
                effectiveHighlight?.kind === "view" &&
                effectiveHighlight.view === v.id
              }
              onOpen={openSmartView}
            />
          ))}
          {listNames.length > 0 ? (
            <li className="tasks-section-sep" aria-hidden="true" />
          ) : null}
          {sidebar.sections.map(({ group, lists }) => {
            const groupOpen = !groupsCollapsed.includes(group.id);
            return (
              <li key={`group:${group.id}`} className="tasks-section-group">
                <button
                  type="button"
                  className="tasks-section-group-header"
                  aria-expanded={groupOpen}
                  aria-label={
                    groupOpen
                      ? `Collapse ${group.name}`
                      : `Expand ${group.name}`
                  }
                  onClick={() => toggleGroupCollapsed(group.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setGroupMenu({
                      x: e.clientX,
                      y: e.clientY,
                      groupId: group.id,
                      groupName: group.name,
                    });
                  }}
                >
                  <span
                    className="tasks-section-group-chevron-slot"
                    aria-hidden="true"
                  >
                    <InboxChevron open={groupOpen} />
                  </span>
                  <span className="tasks-section-group-label">{group.name}</span>
                </button>
                {groupOpen ? (
                  <ul className="tasks-section-group-list" role="list">
                    {lists.length === 0 ? (
                      <li className="tasks-section-group-empty" aria-hidden="true">
                        No lists
                      </li>
                    ) : null}
                    {lists.map((entry) => (
                      <ListRow
                        key={`list:${entry.name}`}
                        entry={entry}
                        selected={
                          effectiveHighlight?.kind === "list" &&
                          effectiveHighlight.list === entry.name
                        }
                        onOpenList={openList}
                        onContextMenu={handleListContextMenu}
                      />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {sidebar.ungrouped.map((entry) => (
            <ListRow
              key={`list:${entry.name}`}
              entry={entry}
              selected={
                effectiveHighlight?.kind === "list" &&
                effectiveHighlight.list === entry.name
              }
              onOpenList={openList}
              onContextMenu={handleListContextMenu}
            />
          ))}
        </ul>
      ) : null}

      <TaskListPropertiesDialog
        open={createOpen}
        mode="create"
        listName=""
        groupId=""
        color=""
        groups={groups}
        saving={createSaving}
        onCancel={() => {
          if (createSaving) return;
          setCreateOpen(false);
        }}
        onSave={(value) => {
          void onCreateList(value);
        }}
      />

      <PromptDialog
        open={renameList !== null}
        title="Rename list"
        description="Rename this task list folder."
        label="List name"
        defaultValue={renameList ?? ""}
        confirmLabel="Rename"
        onCancel={() => setRenameList(null)}
        onConfirm={(value) => {
          const from = renameList;
          setRenameList(null);
          if (!from) return;
          void renameListFolder(from, value.trim()).then((next) => {
            if (next && filterList === from) openList(next);
          });
        }}
      />

      <PromptDialog
        open={renameGroup !== null}
        title="Rename group"
        description="Rename this task list group."
        label="Group name"
        defaultValue={renameGroup?.groupName ?? ""}
        confirmLabel="Rename"
        onCancel={() => setRenameGroup(null)}
        onConfirm={(value) => {
          const target = renameGroup;
          setRenameGroup(null);
          if (!target) return;
          const name = value.trim();
          if (!name) return;
          void (async () => {
            try {
              const group = groups.find((g) => g.id === target.groupId);
              if (!group) return;
              await upsertTaskListGroup(group.id, name, group.order);
              await refreshMeta();
            } catch (e) {
              console.error(e);
            }
          })();
        }}
      />

      <TaskListPropertiesDialog
        open={settingsList !== null}
        mode="edit"
        listName={settingsList ?? ""}
        groupId={
          settingsList ? taskListGroupId(metaByName, settingsList) : ""
        }
        color={settingsList ? taskListColor(metaByName, settingsList) : ""}
        groups={groups}
        saving={settingsSaving}
        onCancel={() => {
          if (settingsSaving) return;
          setSettingsList(null);
        }}
        onSave={async (value) => {
          if (!settingsList) return;
          setSettingsSaving(true);
          try {
            const finalName = await saveTaskListProperties(
              settingsList,
              value,
              {
                groups,
                renameList: renameListFolder,
              },
            );
            await refreshMeta();
            setSettingsList(null);
            if (filterList === settingsList || filterList === finalName) {
              openList(finalName);
            }
          } catch (e) {
            console.error(e);
          } finally {
            setSettingsSaving(false);
          }
        }}
      />

      <ConfirmDialog
        open={deleteList !== null}
        title="Delete list"
        description={`Delete “${deleteList ?? ""}” and all of its tasks? This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteList(null)}
        onConfirm={() => {
          const name = deleteList;
          setDeleteList(null);
          if (!name) return;
          void (async () => {
            try {
              const path = joinPath(TASKS_FOLDER, name);
              const ok = await removePath(path);
              if (!ok) return;
              if (filterList === name) {
                patchFilters({ list: "" });
                setView("inbox");
              }
              await refreshTree();
              await refreshMeta();
            } catch (e) {
              console.error(e);
            }
          })();
        }}
      />

      <ConfirmDialog
        open={deleteGroup !== null}
        title="Delete group"
        description={`Delete group “${deleteGroup?.groupName ?? ""}”? Lists in this group will become ungrouped.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteGroup(null)}
        onConfirm={() => {
          const target = deleteGroup;
          setDeleteGroup(null);
          if (!target) return;
          void (async () => {
            try {
              await deleteTaskListGroup(target.groupId);
              await refreshMeta();
            } catch (e) {
              console.error(e);
            }
          })();
        }}
      />

      {listMenu ? (
        <TaskListContextMenu
          menu={listMenu}
          onClose={() => setListMenu(null)}
          onRename={() => setRenameList(listMenu.listName)}
          onSettings={() => setSettingsList(listMenu.listName)}
          onDelete={() => setDeleteList(listMenu.listName)}
        />
      ) : null}

      {groupMenu ? (
        <TaskGroupContextMenu
          menu={groupMenu}
          onClose={() => setGroupMenu(null)}
          onRename={() => setRenameGroup(groupMenu)}
          onDelete={() => setDeleteGroup(groupMenu)}
        />
      ) : null}
    </div>
  );
});

import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  collectTaskLabels,
  collectTaskLists,
  createTaskNote,
  ensureTaskIdentities,
  ensureTasksLayout,
  filterTaskIndex,
  loadTaskIndex,
  loadTaskNote,
  localDateTimeHm,
  localDateYmd,
  newTaskId,
  saveTaskNote,
  setTaskStatus,
  taskListFromPath,
  type TaskComment,
  type TaskIndexEntry,
  type TaskNote,
  type TaskPriority,
} from "../lib/taskNotes";
import { absolutePath, joinPath, parentPath, writeAsset } from "../lib/vaultApi";
import { useTasksPanelStore } from "../store/tasksPanelStore";
import { useVaultStore } from "../store/vaultStore";
import { Select } from "./ui/Select";
import { TasksDateField } from "./tasks/TasksDateField";
import {
  TasksIconAddPlusActive,
  TasksIconAddPlusIdle,
} from "./tasks/tasksIcons";
import { TasksSortableTree } from "./tasks/tree/TasksSortableTree";
import type { FlattenedTaskItem } from "./tasks/tree/types";

function priorityClass(priority: TaskPriority | null | undefined): string {
  if (priority == null) return "";
  return ` is-p${priority}`;
}

function CircleCheck({
  checked,
  priority,
  onClick,
  title,
}: {
  checked: boolean;
  priority?: TaskPriority | null;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`tasks-circle${priorityClass(priority)}${checked ? " is-checked" : ""}`}
      title={title ?? (checked ? "Mark open" : "Mark done")}
      aria-label={title ?? (checked ? "Mark open" : "Mark done")}
      onClick={(e) => {
        e.stopPropagation();
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
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tasks-icon-btn"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function CommentBody({
  body,
  notePath,
}: {
  body: string;
  notePath: string;
}) {
  const parts = useMemo(() => {
    const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const out: { type: "text" | "img"; value: string; alt?: string }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      if (m.index > last) {
        out.push({ type: "text", value: body.slice(last, m.index) });
      }
      out.push({ type: "img", value: m[2]!, alt: m[1] });
      last = m.index + m[0].length;
    }
    if (last < body.length) out.push({ type: "text", value: body.slice(last) });
    return out.length > 0 ? out : [{ type: "text" as const, value: body }];
  }, [body]);

  return (
    <div className="tasks-comment-body">
      {parts.map((p, i) =>
        p.type === "text" ? (
          <span key={i} className="tasks-comment-text">
            {p.value}
          </span>
        ) : (
          <CommentImage key={i} notePath={notePath} rel={p.value} alt={p.alt ?? ""} />
        ),
      )}
    </div>
  );
}

function CommentImage({
  notePath,
  rel,
  alt,
}: {
  notePath: string;
  rel: string;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cleaned = rel.replace(/^\.\//, "");
    const vaultRel = joinPath(parentPath(notePath), cleaned);
    void absolutePath(vaultRel)
      .then((abs) => {
        if (!cancelled) setSrc(convertFileSrc(abs));
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [notePath, rel]);
  if (!src) return <span className="tasks-comment-img-missing">{alt || rel}</span>;
  return <img className="tasks-comment-img" src={src} alt={alt} />;
}

function TaskDetailPanel({
  path,
  onClose,
  onChanged,
  onPrev,
  onNext,
}: {
  path: string;
  onClose: () => void;
  onChanged: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [note, setNote] = useState<TaskNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshTree = useVaultStore((s) => s.refreshTree);

  const reload = useCallback(async () => {
    try {
      const n = await loadTaskNote(path);
      setNote(n);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setNote(null);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async (next: TaskNote) => {
      setNote(next);
      await saveTaskNote(next);
      onChanged();
      void refreshTree();
    },
    [onChanged, refreshTree],
  );

  const listName = taskListFromPath(path) || "Tasks";

  return (
    <aside className="tasks-detail-sheet" aria-label="Task details">
      <header className="tasks-detail-sheet-head">
        <span className="tasks-detail-list-chip">
          <span className="tasks-inbox-glyph" aria-hidden="true" />
          {listName}
        </span>
        <div className="tasks-detail-sheet-actions">
          <IconBtn label="Previous" onClick={onPrev}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 10 8 6l4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </IconBtn>
          <IconBtn label="Next" onClick={onNext}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 6 8 10l4-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </IconBtn>
        </div>
      </header>

      {error ? <p className="tasks-detail-error">{error}</p> : null}
      {!note && !error ? <p className="tasks-detail-loading">Loading…</p> : null}

      {note ? (
        <div className="tasks-detail-sheet-body">
          <div className="tasks-detail-main">
            <div className="tasks-detail-title-row">
              <CircleCheck
                checked={note.attrs.status === "done"}
                priority={note.attrs.priority}
                onClick={() =>
                  void persist({
                    ...note,
                    attrs: {
                      ...note.attrs,
                      status: note.attrs.status === "done" ? "open" : "done",
                    },
                  })
                }
              />
              <input
                className="tasks-detail-title"
                value={note.title}
                onChange={(e) => setNote({ ...note, title: e.target.value })}
                onBlur={(e) => {
                  const title = e.target.value.trim() || "Untitled";
                  void persist({ ...note, title });
                }}
                aria-label="Task title"
              />
            </div>

            <textarea
              className="tasks-detail-desc"
              value={note.description}
              placeholder="Description"
              rows={2}
              onChange={(e) =>
                setNote({ ...note, description: e.target.value })
              }
              onBlur={() => void persist(note)}
              aria-label="Description"
            />

            <div className="tasks-detail-subtasks">
              {addingSubtask ? (
                <form
                  className="tasks-add-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = subtaskDraft.trim();
                    if (!text) {
                      setAddingSubtask(false);
                      return;
                    }
                    void (async () => {
                      await createTaskNote({
                        title: text,
                        list: taskListFromPath(note.path) || "Inbox",
                        parent: note.attrs.id || null,
                      });
                      setSubtaskDraft("");
                      setAddingSubtask(false);
                      onChanged();
                    })();
                  }}
                >
                  <input
                    autoFocus
                    value={subtaskDraft}
                    onChange={(e) => setSubtaskDraft(e.target.value)}
                    onBlur={() => {
                      if (!subtaskDraft.trim()) setAddingSubtask(false);
                    }}
                    placeholder="Subtask name"
                    aria-label="Subtask name"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="tasks-text-link"
                  onClick={() => setAddingSubtask(true)}
                >
                  + Add subtask
                </button>
              )}
            </div>

            <div className="tasks-detail-comments">
              <ul className="tasks-comment-list">
                {note.comments.map((c, i) => (
                  <li key={`${c.at}-${i}`} className="tasks-comment">
                    <div className="tasks-comment-at">{c.at}</div>
                    <CommentBody body={c.body} notePath={note.path} />
                  </li>
                ))}
              </ul>
              <form
                className="tasks-comment-compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = commentDraft.trim();
                  if (!body) return;
                  const comment: TaskComment = {
                    at: localDateTimeHm(),
                    body,
                  };
                  void persist({
                    ...note,
                    comments: [...note.comments, comment],
                  });
                  setCommentDraft("");
                }}
              >
                <div className="tasks-comment-input-wrap">
                  <input
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Comment"
                    aria-label="Comment"
                  />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file || !note) return;
                      void (async () => {
                        const buf = new Uint8Array(await file.arrayBuffer());
                        const url = await writeAsset(note.path, file.name, buf);
                        const embed = `![](${url})`;
                        const body = commentDraft.trim()
                          ? `${commentDraft.trim()}\n\n${embed}`
                          : embed;
                        await persist({
                          ...note,
                          comments: [
                            ...note.comments,
                            { at: localDateTimeHm(), body },
                          ],
                        });
                        setCommentDraft("");
                      })();
                    }}
                  />
                  <button
                    type="button"
                    className="tasks-icon-btn"
                    title="Attach image"
                    aria-label="Attach image"
                    onClick={() => fileRef.current?.click()}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M4.5 11.5 9.2 6.8a2 2 0 0 1 2.8 2.8l-5.2 5.2a3.2 3.2 0 1 1-4.5-4.5l5.5-5.5a4 4 0 0 1 5.7 5.7L8 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
                {commentDraft.trim() ? (
                  <button type="submit" className="tasks-btn tasks-btn-primary">
                    Comment
                  </button>
                ) : null}
              </form>
            </div>
          </div>

          <div className="tasks-detail-meta-col">
            <div className="tasks-meta-row">
              <span className="tasks-meta-label">Project</span>
              <span className="tasks-meta-value">{listName}</span>
            </div>
            <div className="tasks-meta-row">
              <span className="tasks-meta-label">Due</span>
              <TasksDateField
                value={note.attrs.due}
                onChange={(due) => {
                  void persist({
                    ...note,
                    attrs: { ...note.attrs, due },
                  });
                }}
              />
            </div>
            <div className="tasks-meta-row">
              <span className="tasks-meta-label">Priority</span>
              <Select
                variant="field"
                aria-label="Priority"
                value={
                  note.attrs.priority != null
                    ? String(note.attrs.priority)
                    : ""
                }
                options={[
                  { value: "", label: "P4" },
                  { value: "1", label: "P1" },
                  { value: "2", label: "P2" },
                  { value: "3", label: "P3" },
                  { value: "4", label: "P4" },
                ]}
                onChange={(v) => {
                  const priority =
                    v === "1" || v === "2" || v === "3" || v === "4"
                      ? (Number(v) as TaskPriority)
                      : null;
                  void persist({
                    ...note,
                    attrs: { ...note.attrs, priority },
                  });
                }}
              />
            </div>
            <label className="tasks-meta-row tasks-meta-row-stack">
              <span className="tasks-meta-label">Labels</span>
              <input
                type="text"
                value={note.attrs.labels.join(", ")}
                placeholder="Add labels"
                onChange={(e) =>
                  setNote({
                    ...note,
                    attrs: {
                      ...note.attrs,
                      labels: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  })
                }
                onBlur={() => void persist(note)}
              />
            </label>
            <p className="tasks-detail-path" title={note.path}>
              {note.path}
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function TasksView() {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const view = useTasksPanelStore((s) => s.view);
  const filters = useTasksPanelStore((s) => s.filters);
  const patchFilters = useTasksPanelStore((s) => s.patchFilters);
  const selectedPath = useTasksPanelStore((s) => s.selectedPath);
  const setSelectedPath = useTasksPanelStore((s) => s.setSelectedPath);

  const [entries, setEntries] = useState<TaskIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDue, setQuickDue] = useState("");
  const [quickPriority, setQuickPriority] = useState<TaskPriority | "">("");
  const [quickList, setQuickList] = useState("Inbox");
  const [quickLabels, setQuickLabels] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const today = localDateYmd();
  const titleRef = useRef<HTMLInputElement>(null);

  const reloadIndex = useCallback(async () => {
    try {
      await ensureTaskIdentities(useVaultStore.getState().tree);
      const list = await loadTaskIndex(useVaultStore.getState().tree);
      setEntries(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await ensureTasksLayout();
      if (!cancelled) await refreshTree();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTree]);

  useEffect(() => {
    void reloadIndex();
  }, [tree, reloadIndex]);

  useEffect(() => {
    if (adding) titleRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const lists = useMemo(() => collectTaskLists(tree), [tree]);
  const labels = useMemo(() => collectTaskLabels(entries), [entries]);
  const visible = useMemo(
    () => filterTaskIndex(entries, view, filters, today),
    [entries, view, filters, today],
  );

  const viewTitle = useMemo(() => {
    if (view === "today") return "Today";
    if (view === "upcoming") return "Upcoming";
    if (view === "inbox") return "Inbox";
    if (view === "filters") return "Filters";
    if (filters.list) return filters.list;
    return "All";
  }, [view, filters.list]);

  const selectedIndex = visible.findIndex((e) => e.path === selectedPath);

  const commitInlineTitle = async (
    item: { path: string },
    title: string,
  ) => {
    const next = title.trim() || "Untitled";
    setEditingId(null);
    const note = await loadTaskNote(item.path);
    if (note.title === next) return;
    await saveTaskNote({ ...note, title: next });
    await refreshTree();
  };

  const submitQuickAdd = async () => {
    const title = quickTitle.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    const list =
      view === "inbox" ? "Inbox" : quickList || filters.list || "Inbox";
    const due = quickDue || (view === "today" ? today : null);
    const priority = quickPriority === "" ? null : quickPriority;
    const labelList = quickLabels
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const id = newTaskId();
    const path = await createTaskNote({
      title,
      list,
      due,
      priority,
      labels: labelList,
      id,
    });
    setEntries((prev) => {
      if (prev.some((e) => e.path === path || e.id === id)) return prev;
      const entry: TaskIndexEntry = {
        path,
        id,
        title,
        status: "open",
        due,
        priority,
        labels: labelList,
        created: today,
        parent: null,
        list,
        subtaskTotal: 0,
        subtaskDone: 0,
        commentCount: 0,
        subtasks: [],
        description: "",
      };
      return [...prev, entry];
    });
    setQuickTitle("");
    // Stay in add mode; reconcile from vault without blanking the list.
    void refreshTree();
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const saveDue = async (path: string, due: string | null) => {
    const note = await loadTaskNote(path);
    await saveTaskNote({
      ...note,
      attrs: { ...note.attrs, due },
    });
    await refreshTree();
  };

  const treeSortable = view !== "today" && view !== "upcoming";

  const onToggleStatus = async (item: FlattenedTaskItem) => {
    await setTaskStatus(
      item.path,
      item.status === "done" ? "open" : "done",
    );
    await refreshTree();
  };

  return (
    <div className={selectedPath ? "tasks-view has-detail" : "tasks-view"}>
      <div className="tasks-list-column">
        <header className="tasks-view-header">
          <h1 className="tasks-view-title">{viewTitle}</h1>
          {view === "filters" ? (
            <div className="tasks-view-filters">
              <Select
                aria-label="Priority"
                value={
                  filters.priority === "" ? "" : String(filters.priority)
                }
                options={[
                  { value: "", label: "Any priority" },
                  { value: "1", label: "P1" },
                  { value: "2", label: "P2" },
                  { value: "3", label: "P3" },
                  { value: "4", label: "P4" },
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
          {loading && entries.length === 0 ? (
            <p className="tasks-empty">Loading…</p>
          ) : visible.length === 0 && !adding ? (
            <p className="tasks-empty">No tasks in this view.</p>
          ) : (
            <TasksSortableTree
              entries={visible}
              expanded={expanded}
              selectedPath={selectedPath}
              sortable={treeSortable}
              vaultTree={tree}
              onExpandPath={(path) =>
                setExpanded((prev) => new Set(prev).add(path))
              }
              onPersisted={() => void refreshTree()}
              handlers={{
                onSelect: setSelectedPath,
                onToggleStatus: (item) => {
                  void onToggleStatus(item);
                },
                onToggleCollapse: toggleExpand,
                onEditTitle: (item) => {
                  setEditingId(String(item.id));
                  setEditTitle(item.title);
                },
                onDueChange: (path, due) => {
                  void saveDue(path, due);
                },
                editingId,
                editTitle,
                onEditTitleChange: setEditTitle,
                onCommitEdit: (item, title) => {
                  void commitInlineTitle(item, title);
                },
                onCancelEdit: () => setEditingId(null),
                editInputRef,
              }}
            />
          )}

          {adding ? (
            <div className="tasks-composer">
              <input
                ref={titleRef}
                className="tasks-composer-title"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAdding(false);
                    setQuickTitle("");
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitQuickAdd();
                  }
                }}
                placeholder="Task name"
                aria-label="Task name"
              />
              <div className="tasks-composer-bar">
                <div className="tasks-composer-chips">
                  <div className="tasks-chip tasks-chip-date">
                    <TasksDateField
                      variant="chip"
                      value={quickDue || null}
                      onChange={(due) => setQuickDue(due ?? "")}
                    />
                  </div>
                  <label className="tasks-chip">
                    <span>Priority</span>
                    <select
                      value={quickPriority === "" ? "" : String(quickPriority)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setQuickPriority(
                          v === "1" || v === "2" || v === "3" || v === "4"
                            ? (Number(v) as TaskPriority)
                            : "",
                        );
                      }}
                    >
                      <option value="">None</option>
                      <option value="1">P1</option>
                      <option value="2">P2</option>
                      <option value="3">P3</option>
                      <option value="4">P4</option>
                    </select>
                  </label>
                  <label className="tasks-chip">
                    <span>Labels</span>
                    <input
                      type="text"
                      value={quickLabels}
                      onChange={(e) => setQuickLabels(e.target.value)}
                      placeholder="work, home"
                    />
                  </label>
                  <label className="tasks-chip">
                    <span>List</span>
                    <select
                      value={quickList}
                      onChange={(e) => setQuickList(e.target.value)}
                    >
                      <option value="Inbox">Inbox</option>
                      {lists
                        .filter((l) => l !== "Inbox")
                        .map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="tasks-composer-actions">
                  <button
                    type="button"
                    className="tasks-icon-btn"
                    title="Cancel"
                    aria-label="Cancel"
                    onClick={() => {
                      setAdding(false);
                      setQuickTitle("");
                    }}
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
                    title="Add task"
                    aria-label="Add task"
                    onClick={() => void submitQuickAdd()}
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
          ) : (
            <button
              type="button"
              className="tasks-add-trigger"
              onClick={() => {
                setQuickList(
                  view === "inbox" ? "Inbox" : filters.list || "Inbox",
                );
                if (view === "today") setQuickDue(today);
                setAdding(true);
              }}
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

      {selectedPath ? (
        <TaskDetailPanel
          path={selectedPath}
          onClose={() => setSelectedPath(null)}
          onChanged={() => void reloadIndex()}
          onPrev={
            selectedIndex > 0
              ? () => setSelectedPath(visible[selectedIndex - 1]!.path)
              : undefined
          }
          onNext={
            selectedIndex >= 0 && selectedIndex < visible.length - 1
              ? () => setSelectedPath(visible[selectedIndex + 1]!.path)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

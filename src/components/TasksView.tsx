import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  collectTaskLabels,
  collectTaskLists,
  completeTask,
  createTaskNote,
  ensureTaskIdentities,
  ensureTasksLayout,
  filterTaskIndex,
  loadTaskIndex,
  loadTaskNote,
  localDateTimeHm,
  localDateYmd,
  moveTaskToList,
  newTaskId,
  saveTaskNote,
  taskListFromPath,
  type TaskIndexEntry,
  type TaskNote,
  type TaskPriority,
} from "../lib/taskNotes";
import { absolutePath, joinPath, parentPath, writeAsset } from "../lib/vaultApi";
import { useTasksPanelStore } from "../store/tasksPanelStore";
import { useVaultStore } from "../store/vaultStore";
import { Select } from "./ui/Select";
import { TagChipsInput } from "./TagChipsInput";
import {
  TasksComposer,
  type TasksComposerDraft,
} from "./tasks/TasksComposer";
import { TasksComposerPicker } from "./tasks/TasksComposerPicker";
import { TasksDateField } from "./tasks/TasksDateField";
import { TaskMetaLine } from "./tasks/TaskMetaLine";
import { TasksPriorityPicker } from "./tasks/TasksPriorityPicker";
import {
  TasksIconAddPlusActive,
  TasksIconAddPlusIdle,
  TasksIconComment,
  TasksIconEdit,
  TasksIconMore,
  TasksIconTrash,
} from "./tasks/tasksIcons";
import { TASK_PRIORITY_OPTIONS } from "../lib/taskPriorities";
import { TasksInboxIcon, TasksListIcon } from "./treeIcons";
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
      title={title ?? (checked ? "Completed" : "Mark done")}
      aria-label={title ?? (checked ? "Completed" : "Mark done")}
      onClick={(e) => {
        e.stopPropagation();
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
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="tasks-icon-btn"
      title={label}
      aria-label={label}
      disabled={disabled}
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

/** Grow a textarea to fit content; never show a scrollbar or resize grip. */
function syncAutosizeTextarea(el: HTMLTextAreaElement | null, minPx: number) {
  if (!el) return;
  el.style.height = "0px";
  el.style.overflowY = "hidden";
  el.style.height = `${Math.max(el.scrollHeight, minPx)}px`;
}

type CommentPendingImage = { url: string; name: string };

function splitCommentBody(body: string): {
  text: string;
  images: CommentPendingImage[];
} {
  const images: CommentPendingImage[] = [];
  const text = body
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, url: string) => {
      images.push({ url, name: alt || url });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

function joinCommentBody(
  text: string,
  images: readonly CommentPendingImage[],
): string {
  const embeds = images.map((img) => `![](${img.url})`).join("\n\n");
  return [text.trim(), embeds].filter(Boolean).join("\n\n");
}

function TaskCommentComposer({
  notePath,
  draft,
  images,
  submitLabel,
  autoFocus,
  onDraftChange,
  onImagesChange,
  onAttachFile,
  onSubmit,
  onCancel,
}: {
  notePath: string;
  draft: string;
  images: CommentPendingImage[];
  submitLabel: string;
  autoFocus?: boolean;
  onDraftChange: (value: string) => void;
  onImagesChange: (images: CommentPendingImage[]) => void;
  onAttachFile: (file: File) => Promise<void>;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    syncAutosizeTextarea(textRef.current, 24);
  }, [draft, images.length]);

  useEffect(() => {
    if (autoFocus) textRef.current?.focus();
  }, [autoFocus]);

  const canSubmit = Boolean(draft.trim() || images.length > 0);

  return (
    <div className="tasks-comment-compose">
      {images.length > 0 ? (
        <div className="tasks-comment-pending">
          {images.map((img, i) => (
            <div key={`${img.url}-${i}`} className="tasks-comment-pending-item">
              <CommentImage notePath={notePath} rel={img.url} alt={img.name} />
              <button
                type="button"
                className="tasks-comment-pending-remove"
                aria-label="Remove image"
                onClick={() =>
                  onImagesChange(images.filter((_, j) => j !== i))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tasks-comment-compose-row">
        <div className="tasks-comment-input-wrap">
          <textarea
            ref={textRef}
            value={draft}
            rows={1}
            onChange={(e) => {
              const el = e.currentTarget;
              onDraftChange(e.target.value);
              requestAnimationFrame(() => syncAutosizeTextarea(el, 24));
            }}
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const pasted: File[] = [];
              for (const item of items) {
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) pasted.push(file);
                }
              }
              if (pasted.length === 0) return;
              e.preventDefault();
              void (async () => {
                for (const file of pasted) await onAttachFile(file);
              })();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onCancel?.();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            placeholder="Comment"
            aria-label="Comment"
          />
          <div className="tasks-composer-actions">
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
            {onCancel ? (
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
            ) : null}
            <button
              type="button"
              className="tasks-composer-submit"
              title={submitLabel}
              aria-label={submitLabel}
              disabled={!canSubmit}
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
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void onAttachFile(file);
          }}
        />
      </div>
    </div>
  );
}

function TaskDetailPanel({
  path,
  entries,
  lists,
  labelCatalog,
  startWithComment = false,
  onStartWithCommentConsumed,
  onClose,
  onChanged,
  onOpenTask,
  onPrev,
  onNext,
}: {
  path: string;
  entries: readonly TaskIndexEntry[];
  lists: string[];
  labelCatalog: string[];
  /** Open the add-comment composer on mount / when requested. */
  startWithComment?: boolean;
  onStartWithCommentConsumed?: () => void;
  onClose: () => void;
  onChanged: () => void;
  onOpenTask: (path: string, opts?: { focusComment?: boolean }) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const [note, setNote] = useState<TaskNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [pendingImages, setPendingImages] = useState<CommentPendingImage[]>(
    [],
  );
  /** Index of comment being edited; null = not editing. */
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(
    null,
  );
  const [addingComment, setAddingComment] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [editingChildPath, setEditingChildPath] = useState<string | null>(null);
  const [completingMain, setCompletingMain] = useState(false);
  const [completingChildPaths, setCompletingChildPaths] = useState(
    () => new Set<string>(),
  );
  const [childDraft, setChildDraft] = useState<TasksComposerDraft>({
    title: "",
    due: "",
    priority: "",
    labels: [],
    list: "Inbox",
  });
  const childTitleRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
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
    setCommentDraft("");
    setPendingImages([]);
    setEditingCommentIndex(null);
    setAddingComment(false);
    setAddingChild(false);
    setEditingChildPath(null);
    setCompletingMain(false);
    setCompletingChildPaths(new Set());
  }, [reload]);

  useEffect(() => {
    if (!startWithComment) return;
    setEditingCommentIndex(null);
    setAddingComment(true);
    onStartWithCommentConsumed?.();
  }, [startWithComment, path, onStartWithCommentConsumed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingChildPath) {
        e.preventDefault();
        setEditingChildPath(null);
        setChildDraft((prev) => ({ ...prev, title: "" }));
        return;
      }
      if (editingCommentIndex != null || addingComment) {
        e.preventDefault();
        setEditingCommentIndex(null);
        setAddingComment(false);
        setCommentDraft("");
        setPendingImages([]);
        return;
      }
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, editingCommentIndex, editingChildPath, addingComment]);

  useEffect(() => {
    if (addingChild || editingChildPath) childTitleRef.current?.focus();
  }, [addingChild, editingChildPath]);

  useEffect(() => {
    syncAutosizeTextarea(titleRef.current, Math.round(1.28 * 16 * 1.35));
    syncAutosizeTextarea(descRef.current, 28);
  }, [note?.title, note?.description, path]);

  const persist = useCallback(
    async (next: TaskNote) => {
      setNote(next);
      await saveTaskNote(next);
      onChanged();
      void refreshTree();
    },
    [onChanged, refreshTree],
  );

  const listName = taskListFromPath(path) || "Inbox";
  const isNested = Boolean(note?.attrs.parent);
  const children = useMemo(() => {
    if (!note?.attrs.id) return [];
    const id = note.attrs.id;
    return entries.filter((e) => e.parent === id);
  }, [entries, note?.attrs.id]);

  const attachImageFile = useCallback(
    async (file: File) => {
      if (!note) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      const stamp = Date.now();
      const ext =
        file.type === "image/jpeg" || file.type === "image/jpg"
          ? "jpg"
          : file.type === "image/webp"
            ? "webp"
            : file.type === "image/gif"
              ? "gif"
              : "png";
      const name =
        file.name && /\.\w+$/.test(file.name)
          ? file.name
          : `screenshot-${stamp}.${ext}`;
      const url = await writeAsset(note.path, name, buf);
      setPendingImages((prev) => [...prev, { url, name }]);
    },
    [note],
  );

  const cancelCommentComposer = useCallback(() => {
    setEditingCommentIndex(null);
    setAddingComment(false);
    setCommentDraft("");
    setPendingImages([]);
  }, []);

  const startEditComment = useCallback(
    (index: number) => {
      if (!note) return;
      const c = note.comments[index];
      if (!c) return;
      const split = splitCommentBody(c.body);
      setAddingComment(false);
      setEditingCommentIndex(index);
      setCommentDraft(split.text);
      setPendingImages(split.images);
    },
    [note],
  );

  const deleteComment = useCallback(
    (index: number) => {
      if (!note) return;
      const next = note.comments.filter((_, i) => i !== index);
      void persist({ ...note, comments: next });
      if (editingCommentIndex === index) cancelCommentComposer();
      else if (editingCommentIndex != null && editingCommentIndex > index) {
        setEditingCommentIndex(editingCommentIndex - 1);
      }
    },
    [note, persist, editingCommentIndex, cancelCommentComposer],
  );

  const submitComment = useCallback(async () => {
    if (!note) return;
    const body = joinCommentBody(commentDraft, pendingImages);
    if (!body) return;
    if (editingCommentIndex != null) {
      const comments = note.comments.map((c, i) =>
        i === editingCommentIndex ? { ...c, body } : c,
      );
      await persist({ ...note, comments });
      cancelCommentComposer();
      return;
    }
    await persist({
      ...note,
      comments: [...note.comments, { at: localDateTimeHm(), body }],
    });
    cancelCommentComposer();
  }, [
    note,
    commentDraft,
    pendingImages,
    editingCommentIndex,
    persist,
    cancelCommentComposer,
  ]);

  const submitChild = useCallback(async () => {
    if (!note) return;
    const title = childDraft.title.trim();
    if (!title) {
      setAddingChild(false);
      setEditingChildPath(null);
      return;
    }
    const list = childDraft.list.trim() || listName;
    const due = childDraft.due || null;
    const priority = childDraft.priority === "" ? null : childDraft.priority;
    const labels = childDraft.labels;

    if (editingChildPath) {
      const childNote = await loadTaskNote(editingChildPath);
      await saveTaskNote({
        ...childNote,
        title,
        attrs: {
          ...childNote.attrs,
          due,
          priority,
          labels,
        },
      });
      let nextPath = editingChildPath;
      try {
        nextPath = await moveTaskToList(editingChildPath, list);
      } catch {
        nextPath = editingChildPath;
      }
      setEditingChildPath(null);
      setChildDraft((prev) => ({ ...prev, title: "" }));
      onChanged();
      await refreshTree();
      if (nextPath !== editingChildPath) {
        // Stay on parent detail; index refresh is enough.
      }
      return;
    }

    let parentId = note.attrs.id;
    if (!parentId) {
      parentId = newTaskId();
      await persist({
        ...note,
        attrs: { ...note.attrs, id: parentId },
      });
    }
    await createTaskNote({
      title,
      list,
      due,
      priority,
      labels,
      parent: parentId,
    });
    setChildDraft({
      title: "",
      due: "",
      priority: "",
      labels: [],
      list,
    });
    setAddingChild(false);
    onChanged();
    await refreshTree();
  }, [
    note,
    childDraft,
    listName,
    editingChildPath,
    persist,
    onChanged,
    refreshTree,
  ]);

  const saveChildDue = useCallback(
    async (childPath: string, due: string | null) => {
      const childNote = await loadTaskNote(childPath);
      await saveTaskNote({
        ...childNote,
        attrs: { ...childNote.attrs, due },
      });
      onChanged();
      await refreshTree();
    },
    [onChanged, refreshTree],
  );

  return createPortal(
    <div className="tasks-detail-root" role="presentation">
      <button
        type="button"
        className="tasks-detail-backdrop"
        tabIndex={-1}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        className="tasks-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
      >
        <header className="tasks-detail-dialog-head">
          <span className="tasks-detail-list-chip">
            <span className="tasks-detail-list-icon" aria-hidden="true">
              {listName === "Inbox" ? <TasksInboxIcon /> : <TasksListIcon />}
            </span>
            {listName}
          </span>
          <div className="tasks-detail-dialog-actions">
            <IconBtn label="Previous" onClick={onPrev} disabled={!onPrev}>
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
            <IconBtn label="Next" onClick={onNext} disabled={!onNext}>
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
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
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
        {!note && !error ? (
          <p className="tasks-detail-loading">Loading…</p>
        ) : null}

        {note ? (
          <div className="tasks-detail-dialog-body">
            <div className="tasks-detail-main">
              <div className="tasks-detail-fields">
                <CircleCheck
                  checked={
                    note.attrs.status === "done" || completingMain
                  }
                  priority={note.attrs.priority}
                  onClick={() => {
                    if (note.attrs.status === "done" || completingMain) return;
                    void (async () => {
                      setCompletingMain(true);
                      await new Promise((r) => setTimeout(r, 200));
                      try {
                        await completeTask(note.path, {
                          tree: useVaultStore.getState().tree,
                          index: entries,
                        });
                        onChanged();
                        await refreshTree();
                        onClose();
                      } catch (e) {
                        console.error(e);
                        setCompletingMain(false);
                      }
                    })();
                  }}
                />
                <textarea
                  ref={titleRef}
                  className="tasks-detail-title"
                  value={note.title}
                  rows={1}
                  onChange={(e) => {
                    setNote({ ...note, title: e.target.value });
                    syncAutosizeTextarea(
                      e.currentTarget,
                      Math.round(1.28 * 16 * 1.35),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                  }}
                  onBlur={(e) => {
                    const title = e.target.value.trim() || "Untitled";
                    void persist({ ...note, title });
                  }}
                  aria-label="Task title"
                />
                <textarea
                  ref={descRef}
                  className="tasks-detail-desc"
                  value={note.description}
                  placeholder="Description"
                  rows={1}
                  onChange={(e) => {
                    setNote({ ...note, description: e.target.value });
                    syncAutosizeTextarea(e.currentTarget, 28);
                  }}
                  onBlur={() => void persist(note)}
                  aria-label="Description"
                />
              </div>

              {!isNested ? (
                <div className="tasks-detail-subtasks">
                  {children.length > 0 ? (
                    <ul className="tasks-detail-child-list">
                      {children.map((child) =>
                        editingChildPath === child.path ? (
                          <li key={child.path} className="tasks-detail-child-edit">
                            <TasksComposer
                              variant="row"
                              draft={childDraft}
                              lists={lists}
                              labelCatalog={labelCatalog}
                              titleRef={childTitleRef}
                              submitLabel="Save"
                              onChange={(patch) =>
                                setChildDraft((prev) => ({ ...prev, ...patch }))
                              }
                              onSubmit={() => void submitChild()}
                              onCancel={() => {
                                setEditingChildPath(null);
                                setChildDraft((prev) => ({
                                  ...prev,
                                  title: "",
                                }));
                              }}
                            />
                          </li>
                        ) : (
                          <li key={child.path} className="tasks-detail-child-row">
                            <CircleCheck
                              checked={
                                child.status === "done" ||
                                completingChildPaths.has(child.path)
                              }
                              priority={child.priority}
                              onClick={() => {
                                if (
                                  child.status === "done" ||
                                  completingChildPaths.has(child.path)
                                ) {
                                  return;
                                }
                                void (async () => {
                                  setCompletingChildPaths((prev) => {
                                    const next = new Set(prev);
                                    next.add(child.path);
                                    return next;
                                  });
                                  await new Promise((r) => setTimeout(r, 200));
                                  try {
                                    await completeTask(child.path, {
                                      tree: useVaultStore.getState().tree,
                                      index: entries,
                                    });
                                    onChanged();
                                    await refreshTree();
                                  } catch (e) {
                                    console.error(e);
                                    setCompletingChildPaths((prev) => {
                                      const next = new Set(prev);
                                      next.delete(child.path);
                                      return next;
                                    });
                                  }
                                })();
                              }}
                            />
                            <div className="tasks-detail-child-body">
                              <button
                                type="button"
                                className={
                                  child.status === "done" ||
                                  completingChildPaths.has(child.path)
                                    ? "tasks-detail-child-title is-done"
                                    : "tasks-detail-child-title"
                                }
                                onClick={() => onOpenTask(child.path)}
                              >
                                {child.title}
                              </button>
                              <TaskMetaLine
                                due={child.due}
                                labels={child.labels}
                                commentCount={child.commentCount}
                                hideSubtasks
                              />
                            </div>
                            <div className="tasks-row-actions">
                              <IconBtn
                                label="Edit"
                                onClick={() => {
                                  setAddingChild(false);
                                  setEditingChildPath(child.path);
                                  setChildDraft({
                                    title: child.title,
                                    due: child.due ?? "",
                                    priority: child.priority ?? "",
                                    labels: [...child.labels],
                                    list: child.list || listName,
                                  });
                                }}
                              >
                                <TasksIconEdit size={24} />
                              </IconBtn>
                              <span
                                className="tasks-row-schedule"
                                onClick={(ev) => ev.stopPropagation()}
                                onKeyDown={(ev) => ev.stopPropagation()}
                              >
                                <TasksDateField
                                  variant="icon"
                                  value={child.due ?? null}
                                  onChange={(due) => {
                                    void saveChildDue(child.path, due);
                                  }}
                                />
                              </span>
                              <IconBtn
                                label="Comments"
                                onClick={() =>
                                  onOpenTask(child.path, { focusComment: true })
                                }
                              >
                                <TasksIconComment size={24} />
                              </IconBtn>
                              <IconBtn
                                label="More"
                                onClick={() => onOpenTask(child.path)}
                              >
                                <TasksIconMore size={24} />
                              </IconBtn>
                            </div>
                          </li>
                        ),
                      )}
                    </ul>
                  ) : null}
                  {addingChild ? (
                    <TasksComposer
                      variant="row"
                      draft={childDraft}
                      lists={lists}
                      labelCatalog={labelCatalog}
                      titleRef={childTitleRef}
                      submitLabel="Add subtask"
                      onChange={(patch) =>
                        setChildDraft((prev) => ({ ...prev, ...patch }))
                      }
                      onSubmit={() => void submitChild()}
                      onCancel={() => {
                        setAddingChild(false);
                        setChildDraft((prev) => ({ ...prev, title: "" }));
                      }}
                    />
                  ) : editingChildPath ? null : (
                    <button
                      type="button"
                      className="tasks-text-link"
                      onClick={() => {
                        setEditingChildPath(null);
                        setChildDraft({
                          title: "",
                          due: "",
                          priority: "",
                          labels: [],
                          list: listName,
                        });
                        setAddingChild(true);
                      }}
                    >
                      + Add subtask
                    </button>
                  )}
                </div>
              ) : null}

              <div className="tasks-detail-comments">
                {note.comments.length > 0 ? (
                  <ul className="tasks-comment-list">
                    {note.comments.map((c, i) => (
                      <li key={`${c.at}-${i}`} className="tasks-comment">
                        {editingCommentIndex === i ? (
                          <TaskCommentComposer
                            notePath={note.path}
                            draft={commentDraft}
                            images={pendingImages}
                            submitLabel="Save"
                            autoFocus
                            onDraftChange={setCommentDraft}
                            onImagesChange={setPendingImages}
                            onAttachFile={attachImageFile}
                            onSubmit={() => void submitComment()}
                            onCancel={cancelCommentComposer}
                          />
                        ) : (
                          <>
                            <div className="tasks-comment-actions">
                              <button
                                type="button"
                                className="tasks-icon-btn"
                                title="Edit comment"
                                aria-label="Edit comment"
                                onClick={() => startEditComment(i)}
                              >
                                <TasksIconEdit size={16} />
                              </button>
                              <button
                                type="button"
                                className="tasks-icon-btn"
                                title="Delete comment"
                                aria-label="Delete comment"
                                onClick={() => deleteComment(i)}
                              >
                                <TasksIconTrash size={16} />
                              </button>
                            </div>
                            <CommentBody body={c.body} notePath={note.path} />
                            <div className="tasks-comment-at">{c.at}</div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {editingCommentIndex == null ? (
                  addingComment ? (
                    <TaskCommentComposer
                      notePath={note.path}
                      draft={commentDraft}
                      images={pendingImages}
                      submitLabel="Comment"
                      autoFocus
                      onDraftChange={setCommentDraft}
                      onImagesChange={setPendingImages}
                      onAttachFile={attachImageFile}
                      onSubmit={() => void submitComment()}
                      onCancel={cancelCommentComposer}
                    />
                  ) : (
                    <button
                      type="button"
                      className="tasks-add-trigger tasks-detail-add-comment"
                      onClick={() => {
                        setEditingCommentIndex(null);
                        setCommentDraft("");
                        setPendingImages([]);
                        setAddingComment(true);
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
                      Add comment
                    </button>
                  )
                ) : null}
              </div>
            </div>

            <aside className="tasks-detail-meta-col">
              <div className="tasks-meta-block">
                <span className="tasks-meta-label">List</span>
                <div className="tasks-meta-control">
                  <TasksComposerPicker
                    aria-label="List"
                    value={listName}
                    display={listName}
                    searchable
                    searchPlaceholder="Filter lists…"
                    options={[
                      { value: "Inbox", label: "Inbox" },
                      ...lists
                        .filter((l) => l !== "Inbox")
                        .map((l) => ({ value: l, label: l })),
                      ...(listName !== "Inbox" &&
                      !lists.includes(listName)
                        ? [{ value: listName, label: listName }]
                        : []),
                    ]}
                    onChange={(nextList) => {
                      if (nextList === listName) return;
                      void (async () => {
                        try {
                          const nextPath = await moveTaskToList(
                            note.path,
                            nextList,
                          );
                          onChanged();
                          await refreshTree();
                          if (nextPath !== note.path) {
                            onOpenTask(nextPath);
                          }
                        } catch (e) {
                          console.error(e);
                        }
                      })();
                    }}
                  />
                </div>
              </div>
              <div className="tasks-meta-block">
                <span className="tasks-meta-label">Due</span>
                <div className="tasks-meta-control">
                  <TasksDateField
                    value={note.attrs.due}
                    emptyLabel="Add date"
                    onChange={(due) => {
                      void persist({
                        ...note,
                        attrs: { ...note.attrs, due },
                      });
                    }}
                  />
                </div>
              </div>
              <div className="tasks-meta-block">
                <span className="tasks-meta-label">Priority</span>
                <div className="tasks-meta-control">
                  <TasksPriorityPicker
                    value={note.attrs.priority ?? ""}
                    emptyLabel="None"
                    onChange={(priority) => {
                      void persist({
                        ...note,
                        attrs: {
                          ...note.attrs,
                          priority: priority === "" ? null : priority,
                        },
                      });
                    }}
                  />
                </div>
              </div>
              <div className="tasks-meta-block">
                <span className="tasks-meta-label">Labels</span>
                <div className="tasks-meta-control">
                  <TagChipsInput
                    className="tasks-detail-labels"
                    tags={note.attrs.labels}
                    catalog={labelCatalog}
                    pastelChips
                    portalPopover
                    placeholder="Add label"
                    ariaLabel="Labels"
                    onChange={(labels) => {
                      const next = {
                        ...note,
                        attrs: { ...note.attrs, labels },
                      };
                      setNote(next);
                      void persist(next);
                    }}
                  />
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function TasksView() {
  const tree = useVaultStore((s) => s.tree);
  const refreshTree = useVaultStore((s) => s.refreshTree);
  const view = useTasksPanelStore((s) => s.view);
  const filters = useTasksPanelStore((s) => s.filters);
  const patchFilters = useTasksPanelStore((s) => s.patchFilters);
  const setView = useTasksPanelStore((s) => s.setView);
  const selectedPath = useTasksPanelStore((s) => s.selectedPath);
  const setSelectedPath = useTasksPanelStore((s) => s.setSelectedPath);
  const expandedPaths = useTasksPanelStore((s) => s.expandedPaths);
  const toggleExpandedPath = useTasksPanelStore((s) => s.toggleExpandedPath);
  const expandPath = useTasksPanelStore((s) => s.expandPath);

  const [entries, setEntries] = useState<TaskIndexEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const expanded = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const [adding, setAdding] = useState(false);
  const [quickDraft, setQuickDraft] = useState<TasksComposerDraft>({
    title: "",
    due: "",
    priority: "",
    labels: [],
    list: "Inbox",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TasksComposerDraft | null>(null);
  const [startWithComment, setStartWithComment] = useState(false);
  const [completingPaths, setCompletingPaths] = useState(
    () => new Set<string>(),
  );
  const [hiddenPaths, setHiddenPaths] = useState(() => new Set<string>());
  const editTitleRef = useRef<HTMLInputElement>(null);
  const today = localDateYmd();
  const titleRef = useRef<HTMLInputElement>(null);

  const clearStartWithComment = useCallback(() => {
    setStartWithComment(false);
  }, []);

  const openTask = useCallback(
    (path: string, opts?: { focusComment?: boolean }) => {
      setStartWithComment(Boolean(opts?.focusComment));
      setSelectedPath(path);
    },
    [setSelectedPath],
  );

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

  // Drop sticky Filters chips when not on the Filters view (they used to
  // empty Inbox / Today after leaving Filters).
  useEffect(() => {
    if (view === "filters") return;
    if (
      filters.priority === "" &&
      !filters.label &&
      !filters.query
    ) {
      return;
    }
    patchFilters({ priority: "", label: "", query: "" });
  }, [view, filters.priority, filters.label, filters.query, patchFilters]);

  useEffect(() => {
    void reloadIndex();
  }, [tree, reloadIndex]);

  useEffect(() => {
    const live = new Set(entries.map((e) => e.path));
    setHiddenPaths((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const p of prev) {
        if (live.has(p)) next.add(p);
      }
      return next.size === prev.size ? prev : next;
    });
    setCompletingPaths((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const p of prev) {
        if (live.has(p)) next.add(p);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  useEffect(() => {
    if (adding) titleRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId) editTitleRef.current?.focus();
  }, [editingId]);

  const patchQuickDraft = (patch: Partial<TasksComposerDraft>) => {
    setQuickDraft((prev) => ({ ...prev, ...patch }));
  };

  const patchEditDraft = (patch: Partial<TasksComposerDraft>) => {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingPath(null);
    setEditDraft(null);
  };

  const startEdit = (item: { id: string | number; path: string; title: string; due?: string | null; priority?: TaskPriority | null }) => {
    const entry = entries.find((e) => e.path === item.path);
    setAdding(false);
    setEditingId(String(item.id));
    setEditingPath(item.path);
    setEditDraft({
      title: item.title,
      due: item.due ?? entry?.due ?? "",
      priority: item.priority ?? entry?.priority ?? "",
      labels: [...(entry?.labels ?? [])],
      list: entry?.list || taskListFromPath(item.path) || "Inbox",
    });
  };
  const lists = useMemo(() => collectTaskLists(tree), [tree]);
  const labels = useMemo(() => collectTaskLabels(entries), [entries]);
  const visible = useMemo(
    () =>
      filterTaskIndex(entries, view, filters, today).filter(
        (e) => !hiddenPaths.has(e.path),
      ),
    [entries, view, filters, today, hiddenPaths],
  );

  /** List implied by the sidebar view (Inbox / named list / fallback). */
  const contextList = useMemo(() => {
    if (view === "inbox") return "Inbox";
    const named = filters.list.trim();
    if (named) return named;
    return "Inbox";
  }, [view, filters.list]);

  const viewTitle = useMemo(() => {
    if (view === "today") return "Today";
    if (view === "inbox") return "Inbox";
    if (view === "filters") return "Filters";
    if (filters.list) return filters.list;
    return "All";
  }, [view, filters.list]);

  const emptyMessage = useMemo(() => {
    if (view === "today") {
      const openElsewhere = entries.filter(
        (e) => e.status === "open" && e.due !== today,
      ).length;
      if (openElsewhere > 0) {
        return `No tasks due today. ${openElsewhere} open elsewhere — try Inbox.`;
      }
      return "No tasks due today.";
    }
    if (view === "all" && filters.list) {
      return `No tasks in ${filters.list}.`;
    }
    return "No tasks in this view.";
  }, [view, filters.list, entries, today]);

  // Keep composer List in sync when the sidebar list/view changes.
  useEffect(() => {
    if (!adding) return;
    setQuickDraft((prev) =>
      prev.list === contextList ? prev : { ...prev, list: contextList },
    );
  }, [adding, contextList]);

  const selectedIndex = visible.findIndex((e) => e.path === selectedPath);

  const commitEdit = async () => {
    if (!editingPath || !editDraft) {
      cancelEdit();
      return;
    }
    const title = editDraft.title.trim() || "Untitled";
    const due = editDraft.due || null;
    const priority = editDraft.priority === "" ? null : editDraft.priority;
    const labelList = editDraft.labels;
    const list = editDraft.list || "Inbox";
    const pathBefore = editingPath;
    try {
      const note = await loadTaskNote(pathBefore);
      await saveTaskNote({
        ...note,
        title,
        attrs: {
          ...note.attrs,
          due,
          priority,
          labels: labelList,
        },
      });
      let nextPath = pathBefore;
      try {
        nextPath = await moveTaskToList(pathBefore, list);
      } catch {
        nextPath = pathBefore;
      }
      cancelEdit();
      if (selectedPath === pathBefore && nextPath !== pathBefore) {
        setSelectedPath(nextPath);
      }
      await refreshTree();
      await reloadIndex();
    } catch {
      // Keep composer open so the user can retry or cancel.
    }
  };

  const submitQuickAdd = async () => {
    const title = quickDraft.title.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    // Prefer explicit composer List; fall back to the open sidebar list.
    const list = quickDraft.list.trim() || contextList;
    const due = quickDraft.due || (view === "today" ? today : null);
    const priority = quickDraft.priority === "" ? null : quickDraft.priority;
    const labelList = quickDraft.labels;
    const id = newTaskId();
    try {
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
      setQuickDraft((prev) => ({ ...prev, title: "", list: contextList }));
      // If the new task would be hidden in the current sidebar view, follow it.
      if (view === "all" && filters.list && list !== filters.list) {
        patchFilters({ list });
      } else if (view === "inbox" && list !== "Inbox") {
        patchFilters({ list });
        setView("all");
      }
      await refreshTree();
      await reloadIndex();
      requestAnimationFrame(() => titleRef.current?.focus());
    } catch (e) {
      console.error(e);
    }
  };

  const toggleExpand = (path: string) => {
    toggleExpandedPath(path);
  };

  const saveDue = async (path: string, due: string | null) => {
    const note = await loadTaskNote(path);
    await saveTaskNote({
      ...note,
      attrs: { ...note.attrs, due },
    });
    await refreshTree();
  };

  const treeSortable = view !== "today";

  const onToggleStatus = async (item: FlattenedTaskItem) => {
    if (item.status === "done") return;
    if (completingPaths.has(item.path) || hiddenPaths.has(item.path)) return;
    const childPaths =
      item.id
        ? entries
            .filter(
              (e) =>
                e.parent === item.id &&
                e.path !== item.path &&
                e.status !== "done",
            )
            .map((e) => e.path)
        : [];
    const branch = [item.path, ...childPaths];
    setCompletingPaths((prev) => {
      const next = new Set(prev);
      for (const p of branch) next.add(p);
      return next;
    });
    await new Promise((r) => setTimeout(r, 200));
    setHiddenPaths((prev) => {
      const next = new Set(prev);
      for (const p of branch) next.add(p);
      return next;
    });
    try {
      await completeTask(item.path, { tree, index: entries });
      if (selectedPath && branch.includes(selectedPath)) {
        setSelectedPath(null);
        setStartWithComment(false);
      }
      await refreshTree();
    } catch (e) {
      console.error(e);
      setHiddenPaths((prev) => {
        const next = new Set(prev);
        for (const p of branch) next.delete(p);
        return next;
      });
      setCompletingPaths((prev) => {
        const next = new Set(prev);
        for (const p of branch) next.delete(p);
        return next;
      });
    }
  };

  return (
    <div className="tasks-view">
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
                    .map((l) => ({ value: l, label: l })),
                ]}
                onChange={(v) => patchFilters({ list: v })}
              />
              <Select
                aria-label="Priority"
                value={
                  filters.priority === "" ? "" : String(filters.priority)
                }
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
          {loading && entries.length === 0 ? (
            <p className="tasks-empty">Loading…</p>
          ) : visible.length === 0 && !adding ? (
            <p className="tasks-empty">{emptyMessage}</p>
          ) : (
            <TasksSortableTree
              entries={visible}
              expanded={expanded}
              selectedPath={selectedPath}
              sortable={treeSortable}
              vaultTree={tree}
              onExpandPath={(path) => expandPath(path)}
              onPersisted={async () => {
                // Frontmatter-only nest does not change tree shape, so refreshTree
                // alone may skip set({ tree }) and never re-run reloadIndex.
                await refreshTree();
                await reloadIndex();
              }}
              handlers={{
                onSelect: (path) => openTask(path),
                onOpenComments: (path) =>
                  openTask(path, { focusComment: true }),
                onToggleStatus: (item) => {
                  void onToggleStatus(item);
                },
                completingPaths,
                onToggleCollapse: toggleExpand,
                onEditTitle: (item) => {
                  startEdit({
                    id: String(item.id),
                    path: item.path,
                    title: item.title,
                    due: item.due,
                    priority: item.priority,
                  });
                },
                onDueChange: (path, due) => {
                  void saveDue(path, due);
                },
                editingId,
                editDraft,
                editLists: lists,
                editLabelCatalog: labels,
                editTitleRef,
                onEditDraftChange: patchEditDraft,
                onCommitEdit: () => {
                  void commitEdit();
                },
                onCancelEdit: cancelEdit,
              }}
            />
          )}

          {adding ? (
            <TasksComposer
              draft={quickDraft}
              lists={lists}
              labelCatalog={labels}
              titleRef={titleRef}
              submitLabel="Add task"
              onChange={patchQuickDraft}
              onSubmit={() => void submitQuickAdd()}
              onCancel={() => {
                setAdding(false);
                setQuickDraft((prev) => ({ ...prev, title: "" }));
              }}
            />
          ) : (
            <button
              type="button"
              className="tasks-add-trigger"
              onClick={() => {
                cancelEdit();
                setQuickDraft({
                  title: "",
                  due: view === "today" ? today : "",
                  priority: "",
                  labels: [],
                  list: contextList,
                });
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
          entries={entries}
          lists={lists}
          labelCatalog={labels}
          startWithComment={startWithComment}
          onStartWithCommentConsumed={clearStartWithComment}
          onClose={() => {
            setStartWithComment(false);
            setSelectedPath(null);
          }}
          onChanged={() => void reloadIndex()}
          onOpenTask={openTask}
          onPrev={
            selectedIndex > 0
              ? () => openTask(visible[selectedIndex - 1]!.path)
              : undefined
          }
          onNext={
            selectedIndex >= 0 && selectedIndex < visible.length - 1
              ? () => openTask(visible[selectedIndex + 1]!.path)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

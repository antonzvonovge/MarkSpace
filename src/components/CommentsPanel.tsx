import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { NoteComment } from "../lib/vaultApi";
import { commentQuoteLabel } from "../lib/commentAnchors";
import { useChatStore } from "../store/chatStore";
import { useChatUiStore } from "../store/chatUiStore";

type Props = {
  width: number;
  /** Vault-relative note path — required for Add to chat. */
  notePath: string;
  comments: NoteComment[];
  activeId: string | null;
  showResolved: boolean;
  drafting: boolean;
  draftQuote: string;
  onShowResolvedChange: (show: boolean) => void;
  onSelect: (id: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
  onBodyChange: (id: string, body: string) => void;
  onDraftSubmit: (body: string) => void;
  onDraftCancel: () => void;
};

export function CommentsPanel({
  width,
  notePath,
  comments,
  activeId,
  showResolved,
  drafting,
  draftQuote,
  onShowResolvedChange,
  onSelect,
  onResolve,
  onDelete,
  onBodyChange,
  onDraftSubmit,
  onDraftCancel,
}: Props) {
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [draftBody, setDraftBody] = useState("");
  const visible = showResolved
    ? comments
    : comments.filter((c) => !c.resolved);

  useEffect(() => {
    if (drafting) {
      setDraftBody("");
      requestAnimationFrame(() => draftRef.current?.focus());
    }
  }, [drafting, draftQuote]);

  const submitDraft = useCallback(() => {
    const body = draftBody.trim();
    if (!body) return;
    onDraftSubmit(body);
    setDraftBody("");
  }, [draftBody, onDraftSubmit]);

  const onDraftKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDraftCancel();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitDraft();
      }
    },
    [onDraftCancel, submitDraft],
  );

  return (
    <aside
      className="document-comments"
      aria-label="Comments"
      style={{ width, flexBasis: width }}
    >
      <div className="comments-toolbar">
        <span className="comments-toolbar-title">Comments</span>
        <label className="comments-show-resolved">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => onShowResolvedChange(e.target.checked)}
          />
          <span>Show resolved</span>
        </label>
      </div>
      <div className="comments-scroll">
        {drafting ? (
          <div className="comment-card is-draft">
            <CommentQuote text={draftQuote} />
            <textarea
              ref={draftRef}
              className="comment-body-input"
              placeholder="Add a comment…"
              rows={3}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              onKeyDown={onDraftKeyDown}
            />
            <div className="comment-card-actions is-draft">
              <button
                type="button"
                className="comment-action-btn"
                onClick={onDraftCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="comment-action-btn is-primary"
                disabled={!draftBody.trim()}
                onClick={submitDraft}
              >
                Comment
              </button>
            </div>
          </div>
        ) : null}
        {visible.length === 0 && !drafting ? (
          <p className="comments-empty">No comments</p>
        ) : (
          visible.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              notePath={notePath}
              active={activeId === c.id}
              onSelect={() => onSelect(c.id)}
              onResolve={(resolved) => onResolve(c.id, resolved)}
              onDelete={() => onDelete(c.id)}
              onBodyChange={(body) => onBodyChange(c.id, body)}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function CommentQuote({ text }: { text: string }) {
  const label = commentQuoteLabel(text);
  const quoteRef = useRef<HTMLQuoteElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    const el = quoteRef.current;
    if (!el) return;
    const measure = () => {
      // Only meaningful while clamped; when expanded compare against clamp height.
      if (expanded) {
        setOverflows(true);
        return;
      }
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [label, expanded]);

  return (
    <div className="comment-quote-wrap">
      <blockquote
        ref={quoteRef}
        className={
          expanded ? "comment-quote is-expanded" : "comment-quote"
        }
      >
        {label}
      </blockquote>
      {overflows || expanded ? (
        <button
          type="button"
          className="comment-quote-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function CommentCard({
  comment,
  notePath,
  active,
  onSelect,
  onResolve,
  onDelete,
  onBodyChange,
}: {
  comment: NoteComment;
  notePath: string;
  active: boolean;
  onSelect: () => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onBodyChange: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const addCommentToDraft = useChatStore((s) => s.addCommentToDraft);
  const setChatOpen = useChatUiStore((s) => s.setOpen);

  useEffect(() => {
    setBody(comment.body);
    setEditing(false);
  }, [comment.id, comment.body]);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => inputRef.current?.focus());
  }, [editing]);

  const save = () => {
    const next = body.trim();
    setEditing(false);
    if (next !== comment.body.trim()) onBodyChange(next);
    else setBody(comment.body);
  };

  const addToChat = () => {
    if (!notePath.trim()) return;
    addCommentToDraft({
      quote: comment.quote,
      body: comment.body,
      sourcePath: notePath,
    });
    setChatOpen(true);
  };

  return (
    <div
      className={
        active
          ? "comment-card is-active"
          : comment.resolved
            ? "comment-card is-resolved"
            : "comment-card"
      }
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <CommentQuote text={comment.quote} />
      {editing ? (
        <textarea
          ref={inputRef}
          className="comment-body-input"
          rows={3}
          value={body}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setBody(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              setBody(comment.body);
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
      ) : (
        <p
          className="comment-body"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {comment.body || (
            <span className="comment-body-placeholder">Empty comment</span>
          )}
        </p>
      )}
      <div
        className="comment-card-actions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="comment-card-actions-left">
          <button
            type="button"
            className={
              comment.resolved
                ? "comment-action-icon is-resolved"
                : "comment-action-icon"
            }
            onClick={() => onResolve(!comment.resolved)}
            title={comment.resolved ? "Unresolve" : "Resolve"}
            aria-label={comment.resolved ? "Unresolve" : "Resolve"}
          >
            <ResolveIcon checked={comment.resolved} />
          </button>
          <button
            type="button"
            className="comment-action-icon"
            onClick={() => setEditing(true)}
            title="Edit"
            aria-label="Edit"
          >
            <EditIcon />
          </button>
          <button
            type="button"
            className="comment-action-icon is-danger"
            onClick={onDelete}
            title="Delete"
            aria-label="Delete"
          >
            <DeleteIcon />
          </button>
        </div>
        <button
          type="button"
          className="comment-action-btn is-primary"
          onClick={addToChat}
          title="Add comment to chat"
        >
          Add to chat
        </button>
      </div>
    </div>
  );
}

function ResolveIcon({ checked }: { checked: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      {checked ? (
        <path
          fill="currentColor"
          d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm3.1 4.4-3.6 3.7a.75.75 0 0 1-1.08 0L4.9 8.05a.75.75 0 1 1 1.08-1.04l1.08 1.12 3.06-3.15a.75.75 0 1 1 1.08 1.02z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          d="M8 2.25a5.75 5.75 0 1 1 0 11.5 5.75 5.75 0 0 1 0-11.5Z"
        />
      )}
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.6 1.9a1.4 1.4 0 0 1 2 2L5.7 11.8 2.5 12.7l.9-3.2L11.6 1.9Zm1.05.95-.6.6 1.1 1.1.6-.6a.4.4 0 0 0-.55-.55l-.55.05ZM4.2 10.5l-.35 1.25 1.25-.35 6.35-6.35-1.05-1.05L4.2 10.5Z"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.25 1.5h3.5a.75.75 0 0 1 .75.75V3h2.75a.75.75 0 0 1 0 1.5h-.4l-.55 8.05A1.75 1.75 0 0 1 10.56 14H5.44a1.75 1.75 0 0 1-1.74-1.45L3.15 4.5H2.75a.75.75 0 0 1 0-1.5H5.5V2.25a.75.75 0 0 1 .75-.75Zm.75 1.5v.5h2V3h-2Zm-2.33 1.5.53 7.75c.03.4.36.7.76.7h5.08c.4 0 .73-.3.76-.7l.53-7.75H4.67ZM6.5 6.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Zm3 0a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}

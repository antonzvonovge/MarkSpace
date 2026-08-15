import { useEffect, useRef } from "react";
import { groupChatHistory } from "../../lib/chatHistoryGroups";
import { useChatStore } from "../../store/chatStore";

type Props = {
  open: boolean;
  onClose: () => void;
};

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function ChatHistoryMenu({ open, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const threads = useChatStore((s) => s.threads);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const selectThread = useChatStore((s) => s.selectThread);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const groups = groupChatHistory(threads);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="chat-history-menu" ref={ref} role="menu">
      {threads.length === 0 && (
        <div className="chat-history-empty">No chats yet</div>
      )}
      {groups.map((group) => (
        <div key={group.id} className="chat-history-group">
          {group.label ? (
            <div className="chat-history-group-label">{group.label}</div>
          ) : null}
          {group.items.map((t) => (
            <div
              key={t.id}
              className={
                t.id === activeThreadId
                  ? "chat-history-item is-active"
                  : "chat-history-item"
              }
            >
              <button
                type="button"
                className="chat-history-item-main"
                role="menuitem"
                onClick={() => {
                  void selectThread(t.id);
                  onClose();
                }}
              >
                <span className="chat-history-title">{t.title}</span>
                <span className="chat-history-time">
                  {relativeTime(t.updatedAt)}
                </span>
              </button>
              <button
                type="button"
                className="chat-history-delete"
                title="Delete chat"
                aria-label={`Delete ${t.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteThread(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

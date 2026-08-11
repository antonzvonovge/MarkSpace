import { useCallback, useEffect, useRef, useState } from "react";
import { listGems, type Gem } from "../../lib/gemsApi";
import { useChatStore } from "../../store/chatStore";
import { useVaultStore } from "../../store/vaultStore";
import { GemEditorDialog } from "../GemEditorDialog";
import { ChatGemIcon } from "./ChatGemIcon";

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM9.75 4.81L4.53 10.03a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.25.25 0 00.108-.064L11.19 6.25 9.75 4.81z"
      />
    </svg>
  );
}

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; gem: Gem };

export function ChatGemsMenu() {
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const gemId = useChatStore((s) => s.gemId);
  const newThreadWithGem = useChatStore((s) => s.newThreadWithGem);
  const clearActiveGem = useChatStore((s) => s.clearActiveGem);
  const refreshActiveGem = useChatStore((s) => s.refreshActiveGem);

  const [open, setOpen] = useState(false);
  const [gems, setGems] = useState<Gem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const wrapRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    if (!vaultPath) {
      setGems([]);
      return;
    }
    setLoading(true);
    try {
      setGems(await listGems());
    } catch {
      setGems([]);
    } finally {
      setLoading(false);
    }
  }, [vaultPath]);

  useEffect(() => {
    if (!open) return;
    void refreshList();
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectGem = (id: string) => {
    void newThreadWithGem(id);
    setOpen(false);
  };

  const openCreate = () => {
    setOpen(false);
    setEditor({ mode: "create" });
  };

  const openEdit = (gem: Gem) => {
    setOpen(false);
    setEditor({ mode: "edit", gem });
  };

  const closeEditor = () => setEditor({ mode: "closed" });

  const onSaved = async (saved: Gem) => {
    closeEditor();
    await refreshList();
    if (gemId === saved.id) {
      await refreshActiveGem();
    }
  };

  const onDeleted = async (deletedId: string) => {
    closeEditor();
    await refreshList();
    if (gemId === deletedId) {
      await clearActiveGem();
    }
  };

  return (
    <div className="chat-gems-wrap" ref={wrapRef}>
      <button
        type="button"
        className={open ? "chat-icon-btn is-active" : "chat-icon-btn"}
        title="Gems"
        aria-label="Gems"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={!vaultPath}
        onClick={() => setOpen((v) => !v)}
      >
        <ChatGemIcon />
      </button>

      {open ? (
        <div className="chat-gems-menu" role="menu">
          {loading && gems.length === 0 ? (
            <div className="chat-gems-empty">Loading…</div>
          ) : null}
          {!loading && gems.length === 0 ? (
            <div className="chat-gems-empty">No gems yet</div>
          ) : null}

          {gems.map((g) => (
            <div key={g.id} className="chat-gems-row">
              <button
                type="button"
                className="chat-gems-edit"
                title="Edit gem"
                aria-label={`Edit ${g.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(g);
                }}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                className="chat-gems-select"
                role="menuitem"
                onClick={() => selectGem(g.id)}
              >
                <span className="chat-gems-name">{g.name}</span>
              </button>
            </div>
          ))}

          <div className="chat-gems-separator" role="separator" />

          <button
            type="button"
            className="chat-gems-create"
            role="menuitem"
            onClick={openCreate}
          >
            Create new
          </button>
        </div>
      ) : null}

      <GemEditorDialog
        open={editor.mode !== "closed"}
        gem={editor.mode === "edit" ? editor.gem : null}
        onCancel={closeEditor}
        onSaved={(g) => void onSaved(g)}
        onDeleted={(id) => void onDeleted(id)}
      />
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { focusActiveMarkdownEditor } from "../editor/completedTasksCommand";
import { captureToIncoming } from "../lib/incomingCapture";
import { invalidateIncomingCaptureIndex } from "../lib/incomingCaptureIndex";
import { bumpIncomingCaptureRevision } from "../lib/incomingUiState";
import { useCaptureStore, type CaptureDraft } from "../store/captureStore";
import { useVaultStore } from "../store/vaultStore";
import { DialogShell } from "./AppDialog";
import { IncomingSectionIcon } from "./treeIcons";

function hasUnderlyingDialog(): boolean {
  if (typeof document === "undefined") return false;
  if (document.querySelector(".command-palette-root")) return true;
  return document.querySelectorAll(".app-dialog-root").length > 0;
}

function noteStem(path: string): string {
  const name = path.split("/").filter(Boolean).pop() ?? path;
  return name.replace(/\.md$/i, "");
}

export function CaptureNoteDialog() {
  const open = useCaptureStore((s) => s.open);
  const draft = useCaptureStore((s) => s.draft);
  const closeCapture = useCaptureStore((s) => s.closeCapture);
  const bodyId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef<CaptureDraft | null>(null);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!open) {
      pendingRef.current = null;
      return;
    }
    setBody(draft.body);
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, draft.body]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !open) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 56)}px`;
  }, [body, open, draft.quote]);

  const submit = () => {
    const trimmed = body.trim();
    const quote = draft.quote?.trim() ?? "";
    if (!trimmed && !quote) return;

    pendingRef.current = {
      body: trimmed,
      quote: quote || undefined,
      sourcePath: draft.sourcePath,
    };
    closeCapture();
    focusActiveMarkdownEditor();

    const payload = pendingRef.current;
    pendingRef.current = null;
    void (async () => {
      try {
        await captureToIncoming(payload);
        bumpIncomingCaptureRevision();
        invalidateIncomingCaptureIndex();
        await useVaultStore.getState().refreshTree();
      } catch (e) {
        useVaultStore.setState({
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  };

  const quote = draft.quote?.trim() ?? "";
  const canSave = Boolean(body.trim() || quote);
  const sourcePath = draft.sourcePath?.trim() ?? "";

  return (
    <DialogShell
      open={open}
      nested={hasUnderlyingDialog()}
      hideTitle
      showClose
      title="Capture to Incoming"
      headerLeading={
        <div className="capture-dialog-title">
          <span className="capture-dialog-title-icon" aria-hidden>
            <IncomingSectionIcon />
          </span>
          <span className="capture-dialog-title-text">Incoming</span>
        </div>
      }
      className="capture-dialog"
      onCancel={closeCapture}
      footer={
        <div className="capture-dialog-footer-meta">
          {sourcePath ? (
            <span className="capture-dialog-source" title={sourcePath}>
              from {noteStem(sourcePath)}
            </span>
          ) : (
            <span className="capture-dialog-source is-empty">Fleeting note</span>
          )}
          <span className="capture-dialog-hint">Ctrl+Enter to save</span>
        </div>
      }
    >
      <div className="app-dialog-body capture-dialog-body">
        {quote ? (
          <div className="capture-dialog-quote-card">
            <div className="capture-dialog-section-label">Selection</div>
            <blockquote className="capture-dialog-quote">{quote}</blockquote>
          </div>
        ) : null}

        <div className="capture-dialog-compose">
          <div className="capture-dialog-input-row">
            <textarea
              ref={textareaRef}
              id={bodyId}
              className="capture-dialog-input"
              value={body}
              rows={1}
              placeholder="What came to mind…"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  submit();
                  return;
                }
                if (e.key === "Tab" && !e.shiftKey && canSave) {
                  const target = saveRef.current;
                  if (target && !target.disabled) {
                    e.preventDefault();
                    target.focus();
                  }
                }
              }}
              spellCheck
              autoComplete="off"
            />
            <button
              ref={saveRef}
              type="button"
              className="capture-dialog-save"
              tabIndex={-1}
              disabled={!canSave}
              onClick={submit}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

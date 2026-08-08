import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  done: number;
  total: number;
  error: string | null;
  onCancel: () => void;
};

export function DictAiFillDialog({
  open,
  done,
  total,
  error,
  onCancel,
}: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const label =
    total > 0
      ? `Filling empty fields… ${done} / ${total}`
      : "Requesting AI…";

  return createPortal(
    <div className="app-dialog-root" role="presentation">
      <button
        type="button"
        className="app-dialog-backdrop"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={!error}
      >
        <header className="app-dialog-header">
          <h2 id={titleId} className="app-dialog-title">
            Fill with AI
          </h2>
        </header>
        <div className="app-dialog-body dict-ai-fill-body">
          {error ? (
            <p className="dict-ai-fill-error" role="alert">
              {error}
            </p>
          ) : (
            <div className="dict-ai-fill-progress">
              <span className="dict-ai-fill-spinner" aria-hidden="true" />
              <span className="dict-ai-fill-label">{label}</span>
            </div>
          )}
        </div>
        <footer className="app-dialog-footer">
          <button
            type="button"
            className="app-dialog-btn"
            onClick={onCancel}
          >
            {error ? "Close" : "Cancel"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

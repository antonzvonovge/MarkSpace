import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PromptDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function DialogShell({
  open,
  title,
  description,
  onCancel,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onCancel: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

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

  return createPortal(
    <div className="app-dialog-root" role="presentation">
      <button
        type="button"
        className="app-dialog-backdrop"
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        className="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="app-dialog-header">
          <h2 id={titleId} className="app-dialog-title">
            {title}
          </h2>
          {description ? (
            <p className="app-dialog-desc">{description}</p>
          ) : null}
        </header>
        {children}
        <footer className="app-dialog-footer">{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

export function PromptDialog({
  open,
  title,
  description,
  label = "Name",
  defaultValue = "",
  confirmLabel = "Create",
  onCancel,
  onConfirm,
}: PromptDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, defaultValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <DialogShell
      open={open}
      title={title}
      description={description}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!value.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={inputId}>
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="app-dialog-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </DialogShell>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Delete",
  danger = true,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => confirmRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  return (
    <DialogShell
      open={open}
      title={title}
      description={description}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={
              danger ? "app-dialog-btn is-danger" : "app-dialog-btn is-primary"
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}

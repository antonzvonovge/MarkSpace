import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { credentialsFromSettings } from "../ai/languageModel";
import { suggestDictEntry } from "../ai/suggestDictEntry";
import { suggestLinkMeta } from "../ai/suggestLinkMeta";
import {
  PROJECT_TYPE_OPTIONS,
  type ProjectTypeId,
} from "../lib/vaultApi";
import { PROJECT_COLOR_SWATCHES } from "../lib/projectColors";
import {
  COURSE_WEEKDAY_SHORT,
  parseClockTimes,
} from "../lib/mdcourseFormat";
import {
  NATIVE_LANGUAGE_OPTIONS,
  nativeLanguageLabel,
  type NativeLanguageId,
} from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { helperModelCallParams } from "../store/vaultAiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { useVaultStore } from "../store/vaultStore";
import { TagChipsInput } from "./TagChipsInput";
import { Select } from "./ui/Select";

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

export function DialogShell({
  open,
  title,
  description,
  onCancel,
  children,
  footer,
  wide = false,
  nested = false,
  className,
  showClose = false,
  hideTitle = false,
  headerLeading,
}: {
  open: boolean;
  title: string;
  description?: string;
  onCancel: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Stack above another dialog; Escape closes this layer first. */
  nested?: boolean;
  className?: string;
  /** X control in the header (top-right). */
  showClose?: boolean;
  /** Hide the title heading; keep `title` for accessibility. */
  hideTitle?: boolean;
  /** Replaces the title in the header row (e.g. a control). */
  headerLeading?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (nested) e.stopImmediatePropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, nested);
    return () => document.removeEventListener("keydown", onKey, nested);
  }, [open, onCancel, nested]);

  if (!open) return null;

  return createPortal(
    <div
      className={nested ? "app-dialog-root is-nested" : "app-dialog-root"}
      role="presentation"
    >
      <button
        type="button"
        className="app-dialog-backdrop"
        tabIndex={-1}
        aria-label="Close dialog"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        className={["app-dialog", wide ? "is-wide" : "", className]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={hideTitle ? undefined : titleId}
        aria-label={hideTitle ? title : undefined}
      >
        <header className="app-dialog-header">
          <div className="app-dialog-header-row">
            {hideTitle ? (
              <div className="app-dialog-header-leading">{headerLeading}</div>
            ) : (
              <h2 id={titleId} className="app-dialog-title">
                {title}
              </h2>
            )}
            {showClose ? (
              <button
                type="button"
                className="app-dialog-close"
                aria-label="Close"
                tabIndex={-1}
                onClick={onCancel}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    d="M4 4l8 8M12 4l-8 8"
                  />
                </svg>
              </button>
            ) : null}
          </div>
          {description ? (
            <p className="app-dialog-desc">{description}</p>
          ) : null}
        </header>
        {children}
        {footer ? (
          <footer className="app-dialog-footer">{footer}</footer>
        ) : null}
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

export type ProjectPropertiesDialogValue = {
  about: string;
  projectType: ProjectTypeId;
  learningLanguage: string;
  color: string;
};

type ProjectPropertiesDialogProps = {
  open: boolean;
  projectName: string;
  /** First-level vault project: show type, language, and color. */
  isProject?: boolean;
  about: string;
  projectType?: ProjectTypeId;
  learningLanguage?: string;
  color?: string;
  saving?: boolean;
  onCancel: () => void;
  onSave: (value: ProjectPropertiesDialogValue) => void;
};

const LEARNING_LANGUAGE_OPTIONS: {
  value: "" | NativeLanguageId;
  label: string;
}[] = [
  { value: "", label: "None" },
  ...NATIVE_LANGUAGE_OPTIONS,
];

export type LinkItemDialogValue = {
  url: string;
  description: string;
  tags: string[];
};

type LinkItemDialogProps = {
  open: boolean;
  title: string;
  confirmLabel?: string;
  initial?: LinkItemDialogValue;
  /** Suggested tags for the chip picker (e.g. tags already used in the file). */
  suggestedTags?: string[];
  onCancel: () => void;
  onConfirm: (value: LinkItemDialogValue) => void;
};

export function LinkItemDialog({
  open,
  title,
  confirmLabel = "Save",
  initial,
  suggestedTags = [],
  onCancel,
  onConfirm,
}: LinkItemDialogProps) {
  const urlId = useId();
  const descId = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const aiSettings = useAiSettingsStore((s) => s.settings);

  useEffect(() => {
    if (!open) {
      suggestAbortRef.current?.abort();
      suggestAbortRef.current = null;
      setSuggesting(false);
      setSuggestError(null);
      return;
    }
    setUrl(initial?.url ?? "");
    setDescription(initial?.description ?? "");
    setTags(initial?.tags ?? []);
    setSuggestError(null);
    const id = window.requestAnimationFrame(() => {
      urlRef.current?.focus();
      urlRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initial]);

  // Grow with content until max-height kicks in, then the textarea scrolls.
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description, open]);

  const submit = () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    onConfirm({
      url: trimmedUrl,
      // On-disk descriptions are single-line.
      description: description.replace(/\s*\n+\s*/g, " ").trim(),
      tags,
    });
  };

  const onSuggest = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || suggesting) return;
    suggestAbortRef.current?.abort();
    const ac = new AbortController();
    suggestAbortRef.current = ac;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const catalog = [...vaultTags, ...suggestedTags, ...tags];
      const result = await suggestLinkMeta({
        url: trimmedUrl,
        tagCatalog: catalog,
        keys: credentialsFromSettings(aiSettings),
        ...helperModelCallParams(),
        abortSignal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (result.description) setDescription(result.description);
      if (result.tags.length > 0) {
        const seen = new Set(tags.map((t) => t.toLowerCase()));
        const merged = [...tags];
        for (const t of result.tags) {
          const key = t.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(t);
        }
        setTags(merged);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      if (suggestAbortRef.current === ac) {
        suggestAbortRef.current = null;
        setSuggesting(false);
      }
    }
  };

  return (
    <DialogShell
      open={open}
      title={title}
      onCancel={onCancel}
      wide
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!url.trim()}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={urlId}>
          URL
        </label>
        <div className="link-dialog-url-row">
          <input
            ref={urlRef}
            id={urlId}
            className="app-dialog-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="https://…"
            spellCheck={false}
            autoComplete="off"
            disabled={suggesting}
          />
          <button
            type="button"
            className="app-dialog-btn link-dialog-suggest-btn"
            disabled={!url.trim() || suggesting}
            title="Fetch the page and suggest a Russian description and tags"
            onClick={() => void onSuggest()}
          >
            {suggesting ? "Suggesting…" : "Suggest"}
          </button>
        </div>
        {suggestError ? (
          <p className="link-dialog-suggest-error" role="alert">
            {suggestError}
          </p>
        ) : null}
        <label className="app-dialog-label" htmlFor={descId}>
          Description
        </label>
        <textarea
          ref={descRef}
          id={descId}
          className="app-dialog-input link-dialog-description"
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Short note about this link"
          spellCheck={false}
          autoComplete="off"
          disabled={suggesting}
        />
        <span className="app-dialog-label">Tags</span>
        <TagChipsInput
          tags={tags}
          onChange={setTags}
          extraCatalog={suggestedTags}
          placeholder="Search or create tag…"
          ariaLabel="Link tags"
          disabled={suggesting}
        />
      </div>
    </DialogShell>
  );
}

export type AddWordDialogValue = {
  word: string;
  transcript: string;
  translation: string;
  examples: string[];
};

type AddWordDialogProps = {
  open: boolean;
  learningLanguageCode?: string;
  learningLanguageLabel?: string;
  notePath?: string;
  onCancel: () => void;
  onConfirm: (value: AddWordDialogValue) => void;
};

export function AddWordDialog({
  open,
  learningLanguageCode = "",
  learningLanguageLabel = "",
  notePath,
  onCancel,
  onConfirm,
}: AddWordDialogProps) {
  const wordId = useId();
  const wordRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aiSettings = useAiSettingsStore((s) => s.settings);
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      setError(null);
      return;
    }
    setWord("");
    setError(null);
    const id = window.requestAnimationFrame(() => {
      wordRef.current?.focus();
      wordRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const submit = async () => {
    const trimmed = word.trim();
    if (!trimmed || busy) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setError(null);
    try {
      const result = await suggestDictEntry({
        word: trimmed,
        learningLanguageCode,
        learningLanguageLabel,
        nativeLanguageCode: nativeLanguage,
        nativeLanguageLabel: nativeLanguageLabel(nativeLanguage),
        keys: credentialsFromSettings(aiSettings),
        ...helperModelCallParams(),
        abortSignal: ac.signal,
        notePath,
      });
      if (ac.signal.aborted) return;
      onConfirm({
        word: trimmed,
        transcript: result.transcript,
        translation: result.translation,
        examples: result.examples,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <DialogShell
      open={open}
      title="Add entry"
      description={
        learningLanguageLabel
          ? `Enter a ${learningLanguageLabel} word or expression. AI will fill transcript, translation, and examples.`
          : "Enter a word or expression. AI will fill transcript, translation, and examples."
      }
      onCancel={() => {
        if (busy) {
          abortRef.current?.abort();
          return;
        }
        onCancel();
      }}
      footer={
        <>
          <button
            type="button"
            className="app-dialog-btn"
            onClick={() => {
              abortRef.current?.abort();
              onCancel();
            }}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!word.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? "Filling…" : "Add"}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={wordId}>
          Word or expression
        </label>
        <input
          ref={wordRef}
          id={wordId}
          className="app-dialog-input"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="e.g. sprechen / auf Wiedersehen"
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        {error ? (
          <p className="link-dialog-suggest-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </DialogShell>
  );
}

export function ProjectPropertiesDialog({
  open,
  projectName,
  isProject = true,
  about,
  projectType = "",
  learningLanguage = "",
  color: initialColor = "",
  saving = false,
  onCancel,
  onSave,
}: ProjectPropertiesDialogProps) {
  const aboutId = useId();
  const colorGroupId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(about);
  const [type, setType] = useState<ProjectTypeId>(projectType);
  const [language, setLanguage] = useState(learningLanguage);
  const [color, setColor] = useState(initialColor);

  useEffect(() => {
    if (!open) return;
    setValue(about);
    setType(projectType);
    setLanguage(learningLanguage);
    setColor(initialColor);
    const id = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, about, projectType, learningLanguage, initialColor]);

  const submit = () => {
    if (saving) return;
    onSave({
      about: value,
      projectType: isProject ? type : "",
      learningLanguage:
        isProject && type === "languageLearning" ? language : "",
      color: isProject ? color : "",
    });
  };

  return (
    <DialogShell
      open={open}
      className="is-folder-props"
      title={isProject ? "Project properties" : "Folder properties"}
      description={projectName}
      onCancel={onCancel}
      footer={
        <>
          <button
            type="button"
            className="app-dialog-btn"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        {isProject ? (
          <>
            <label className="app-dialog-label" id="project-type-label">
              Project type
            </label>
            <Select
              variant="field"
              menuPlacement="below"
              aria-label="Project type"
              value={type}
              options={PROJECT_TYPE_OPTIONS}
              onChange={(next) => {
                setType(next);
                if (next !== "languageLearning") setLanguage("");
              }}
            />

            {type === "languageLearning" ? (
              <>
                <label className="app-dialog-label" id="learning-language-label">
                  Learning language
                </label>
                <Select
                  variant="field"
                  menuPlacement="below"
                  aria-label="Learning language"
                  value={(language || "") as "" | NativeLanguageId}
                  options={LEARNING_LANGUAGE_OPTIONS}
                  onChange={(next) => setLanguage(next)}
                />
              </>
            ) : null}

            <div
              className="app-dialog-label"
              id={colorGroupId}
              role="presentation"
            >
              Color
            </div>
            <div
              className="project-color-picker"
              role="radiogroup"
              aria-labelledby={colorGroupId}
            >
              <button
                type="button"
                role="radio"
                aria-checked={color === ""}
                aria-label="None"
                title="None"
                className={`project-color-swatch is-none${color === "" ? " is-selected" : ""}`}
                disabled={saving}
                onClick={() => setColor("")}
              >
                <span className="project-color-swatch-none-x" aria-hidden>
                  ×
                </span>
              </button>
              {PROJECT_COLOR_SWATCHES.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  role="radio"
                  aria-checked={color === swatch.hex}
                  aria-label={swatch.label}
                  title={swatch.label}
                  className={`project-color-swatch${color === swatch.hex ? " is-selected" : ""}`}
                  style={{ background: swatch.hex }}
                  disabled={saving}
                  onClick={() => setColor(swatch.hex)}
                />
              ))}
            </div>
          </>
        ) : null}

        <label className="app-dialog-label" htmlFor={aboutId}>
          About and AI instructions
        </label>
        <p className="app-dialog-hint">
          {isProject
            ? "What this project is for, and any instructions the AI should follow when working here."
            : "What this folder is for, and any instructions the AI should follow when working with notes here."}
        </p>
        <textarea
          ref={textareaRef}
          id={aboutId}
          className="app-dialog-input app-dialog-textarea"
          value={value}
          rows={5}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            isProject
              ? "Describe the project and add instructions for the AI…"
              : "Describe the folder and add instructions for the AI…"
          }
          spellCheck={false}
        />
      </div>
    </DialogShell>
  );
}

export function ProjectColorPicker({
  color,
  onChange,
  labelledBy,
  disabled,
}: {
  color: string;
  onChange: (hex: string) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  return (
    <div
      className="project-color-picker"
      role="radiogroup"
      aria-labelledby={labelledBy}
    >
      <button
        type="button"
        role="radio"
        aria-checked={color === ""}
        aria-label="None"
        title="None"
        className={`project-color-swatch is-none${color === "" ? " is-selected" : ""}`}
        disabled={disabled}
        onClick={() => onChange("")}
      >
        <span className="project-color-swatch-none-x" aria-hidden>
          ×
        </span>
      </button>
      {PROJECT_COLOR_SWATCHES.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          role="radio"
          aria-checked={color === swatch.hex}
          aria-label={swatch.label}
          title={swatch.label}
          className={`project-color-swatch${color === swatch.hex ? " is-selected" : ""}`}
          style={{ background: swatch.hex }}
          disabled={disabled}
          onClick={() => onChange(swatch.hex)}
        />
      ))}
    </div>
  );
}

export function HabitTrackerCreateDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (name: string, year: number) => void;
}) {
  const nameId = useId();
  const yearId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Habits");
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    if (!open) return;
    setName("Habits");
    setYear(String(new Date().getFullYear()));
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const yearNum = Number.parseInt(year, 10);
  const yearOk = Number.isInteger(yearNum) && yearNum >= 1 && yearNum <= 9999;
  const canSubmit = Boolean(name.trim()) && yearOk;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm(name.trim(), yearNum);
  };

  return (
    <DialogShell
      open={open}
      title="New habit tracker"
      description="Create a yearly habit tracker in the selected location."
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            Create
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={nameId}>
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          className="app-dialog-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <label className="app-dialog-label" htmlFor={yearId}>
          Year
        </label>
        <input
          id={yearId}
          className="app-dialog-input"
          type="number"
          min={1}
          max={9999}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </DialogShell>
  );
}

export type HabitFieldsValue = {
  name: string;
  question: string;
  color: string;
};

export function HabitFieldsDialog({
  open,
  mode,
  initial,
  existingNames,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  mode: "add" | "edit";
  initial: HabitFieldsValue;
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (value: HabitFieldsValue) => void;
}) {
  const nameId = useId();
  const questionId = useId();
  const colorGroupId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [question, setQuestion] = useState(initial.question);
  const [color, setColor] = useState(initial.color);

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setQuestion(initial.question);
    setColor(initial.color);
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initial.name, initial.question, initial.color]);

  const taken = new Set(
    existingNames
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n && n !== initial.name.trim().toLowerCase()),
  );
  const nameKey = name.trim().toLowerCase();
  const duplicate = Boolean(nameKey) && taken.has(nameKey);
  const canSubmit =
    Boolean(name.trim()) && Boolean(question.trim()) && !duplicate;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ name: name.trim(), question: question.trim(), color });
  };

  return (
    <DialogShell
      open={open}
      title={mode === "add" ? "Add habit" : "Edit habit"}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {mode === "add" ? "Add" : "Save"}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={nameId}>
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          className="app-dialog-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {duplicate ? (
          <p className="app-dialog-desc">A habit with this name already exists.</p>
        ) : null}
        <label className="app-dialog-label" htmlFor={questionId}>
          Question
        </label>
        <input
          id={questionId}
          className="app-dialog-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Did you…?"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="app-dialog-label" id={colorGroupId} role="presentation">
          Color
        </div>
        <ProjectColorPicker
          color={color}
          onChange={setColor}
          labelledBy={colorGroupId}
        />
      </div>
    </DialogShell>
  );
}

export type CourseFieldsValue = {
  name: string;
  question: string;
  when: string;
  time: string;
  weekdays: number[];
  color: string;
  start: string;
  days: number;
  ongoing: boolean;
  times: number;
};

export function CourseFieldsDialog({
  open,
  mode,
  initial,
  existingNames,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  mode: "add" | "edit";
  initial: CourseFieldsValue;
  existingNames: string[];
  onCancel: () => void;
  onConfirm: (value: CourseFieldsValue) => void;
}) {
  const nameId = useId();
  const questionId = useId();
  const whenId = useId();
  const timeId = useId();
  const startId = useId();
  const daysId = useId();
  const timesId = useId();
  const weekdaysId = useId();
  const colorGroupId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [question, setQuestion] = useState(initial.question);
  const [when, setWhen] = useState(initial.when);
  const [time, setTime] = useState(initial.time);
  const [weekdays, setWeekdays] = useState<number[]>(initial.weekdays);
  const [color, setColor] = useState(initial.color);
  const [start, setStart] = useState(initial.start);
  const [days, setDays] = useState(String(initial.days));
  const [ongoing, setOngoing] = useState(initial.ongoing);
  const [times, setTimes] = useState(String(initial.times));

  useEffect(() => {
    if (!open) return;
    setName(initial.name);
    setQuestion(initial.question);
    setWhen(initial.when);
    setTime(initial.time);
    setWeekdays(initial.weekdays);
    setColor(initial.color);
    setStart(initial.start);
    setDays(String(initial.days));
    setOngoing(initial.ongoing);
    setTimes(String(initial.times));
    const id = window.requestAnimationFrame(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, initial]);

  const taken = new Set(
    existingNames
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n && n !== initial.name.trim().toLowerCase()),
  );
  const nameKey = name.trim().toLowerCase();
  const duplicate = Boolean(nameKey) && taken.has(nameKey);
  const daysNum = Number.parseInt(days, 10);
  const timesNum = Number.parseInt(times, 10);
  const daysOk = ongoing || (Number.isInteger(daysNum) && daysNum >= 1);
  const timesOk = Number.isInteger(timesNum) && timesNum >= 1 && timesNum <= 8;
  const startOk = /^\d{4}-\d{2}-\d{2}$/.test(start);
  let timeOk = !time.trim();
  let parsedTime: string[] = [];
  if (time.trim()) {
    try {
      parsedTime = parseClockTimes(time);
      timeOk = parsedTime.length > 0;
    } catch {
      timeOk = false;
    }
  }
  const weekdaySet = new Set(weekdays);
  const allWeekdays = weekdaySet.size === 0 || weekdaySet.size === 7;
  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(question.trim()) &&
    !duplicate &&
    daysOk &&
    timesOk &&
    startOk &&
    timeOk;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({
      name: name.trim(),
      question: question.trim(),
      when: when.trim(),
      time: parsedTime.join(" "),
      weekdays: allWeekdays ? [] : [...weekdaySet].sort((a, b) => a - b),
      color,
      start,
      days: ongoing ? 1 : daysNum,
      ongoing,
      times: timesNum,
    });
  };

  return (
    <DialogShell
      open={open}
      title={mode === "add" ? "Add track" : "Edit track"}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={!canSubmit}
            onClick={submit}
          >
            {mode === "add" ? "Add" : "Save"}
          </button>
        </>
      }
    >
      <div className="app-dialog-body">
        <label className="app-dialog-label" htmlFor={nameId}>
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          className="app-dialog-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {duplicate ? (
          <p className="app-dialog-desc">A track with this name already exists.</p>
        ) : null}
        <label className="app-dialog-label" htmlFor={questionId}>
          Question
        </label>
        <input
          id={questionId}
          className="app-dialog-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Did you…?"
        />
        <label className="app-dialog-label" htmlFor={whenId}>
          Note
        </label>
        <input
          id={whenId}
          className="app-dialog-input"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          placeholder="after meals (optional)"
        />
        <label className="app-dialog-label" htmlFor={timeId}>
          Time
        </label>
        <input
          id={timeId}
          className="app-dialog-input"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="08:00 20:00 (optional)"
          spellCheck={false}
        />
        {!timeOk && time.trim() ? (
          <p className="app-dialog-desc">Use 24-hour times like 08:00 20:00.</p>
        ) : null}
        <div className="app-dialog-label" id={weekdaysId}>
          Weekdays
        </div>
        <div className="course-weekday-picks" role="group" aria-labelledby={weekdaysId}>
          {COURSE_WEEKDAY_SHORT.map((label, i) => {
            const dow = i + 1;
            const on = allWeekdays || weekdaySet.has(dow);
            return (
              <button
                key={label}
                type="button"
                className={["course-weekday-pick", on ? "is-on" : ""]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={on}
                onClick={() => {
                  const next = new Set(
                    allWeekdays ? [1, 2, 3, 4, 5, 6, 7] : weekdaySet,
                  );
                  if (next.has(dow)) next.delete(dow);
                  else next.add(dow);
                  if (next.size === 0) {
                    setWeekdays([]);
                    return;
                  }
                  setWeekdays(
                    next.size === 7 ? [] : [...next].sort((a, b) => a - b),
                  );
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="app-dialog-label" htmlFor={startId}>
          Start
        </label>
        <input
          id={startId}
          className="app-dialog-input"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <label className="app-dialog-row">
          <input
            type="checkbox"
            checked={ongoing}
            onChange={(e) => setOngoing(e.target.checked)}
          />
          Ongoing
        </label>
        {!ongoing ? (
          <>
            <label className="app-dialog-label" htmlFor={daysId}>
              Days
            </label>
            <input
              id={daysId}
              className="app-dialog-input"
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </>
        ) : null}
        <label className="app-dialog-label" htmlFor={timesId}>
          Times per day
        </label>
        <input
          id={timesId}
          className="app-dialog-input"
          type="number"
          min={1}
          max={8}
          value={times}
          onChange={(e) => setTimes(e.target.value)}
        />
        <div className="app-dialog-label" id={colorGroupId} role="presentation">
          Color
        </div>
        <ProjectColorPicker
          color={color}
          onChange={setColor}
          labelledBy={colorGroupId}
        />
      </div>
    </DialogShell>
  );
}



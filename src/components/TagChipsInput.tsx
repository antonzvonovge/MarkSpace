import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sanitizeTagName } from "../lib/tagName";
import { useVaultStore } from "../store/vaultStore";

export type TagChipsInputProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** Extra tag names merged with the vault catalog (e.g. tags from the open .mdlnks file). */
  extraCatalog?: string[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Extra class on each chip (e.g. filter accent). */
  chipClassName?: string;
  /** Allow creating a brand-new tag from the draft (default true). */
  allowCreate?: boolean;
  /** Max suggestions shown (default 12). */
  maxSuggestions?: number;
  disabled?: boolean;
};

/** Draft text used for filtering — keeps the raw words, minus a leading `#`. */
function normalizeDraft(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("#")) t = t.slice(1).trim();
  return t;
}

function mergeCatalog(vaultTags: string[], extra: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...vaultTags, ...extra]) {
    const t = tag.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Chip row + inline input with vault-wide tag autocomplete.
 * Focus opens a ranked list; typing filters; ↑↓ Enter commit; Backspace removes last chip.
 */
export function TagChipsInput({
  tags,
  onChange,
  extraCatalog = [],
  placeholder = "Add tag…",
  ariaLabel = "Tags",
  className,
  chipClassName,
  allowCreate = true,
  maxSuggestions = 12,
  disabled = false,
}: TagChipsInputProps) {
  const listId = useId();
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const catalog = useMemo(
    () => mergeCatalog(vaultTags, extraCatalog),
    [extraCatalog, vaultTags],
  );

  const suggestions = useMemo(() => {
    const q = normalizeDraft(draft).toLowerCase();
    const active = new Set(tags.map((t) => t.toLowerCase()));
    return catalog
      .filter((t) => !active.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, maxSuggestions);
  }, [catalog, draft, maxSuggestions, tags]);

  const canCreate = useMemo(() => {
    if (!allowCreate) return false;
    const name = sanitizeTagName(draft);
    if (!name) return false;
    const lower = name.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) return false;
    if (suggestions.some((t) => t.toLowerCase() === lower)) return false;
    return true;
  }, [allowCreate, draft, suggestions, tags]);

  const options = useMemo(() => {
    const list: { kind: "existing" | "create"; value: string }[] = suggestions.map(
      (value) => ({ kind: "existing" as const, value }),
    );
    if (canCreate) {
      list.push({ kind: "create", value: sanitizeTagName(draft) });
    }
    return list;
  }, [canCreate, draft, suggestions]);

  useEffect(() => {
    if (highlight >= options.length) {
      setHighlight(Math.max(0, options.length - 1));
    }
  }, [highlight, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setDraft("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const commitTag = (name: string) => {
    const nextName = sanitizeTagName(name);
    if (!nextName) return;
    const lower = nextName.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) {
      setDraft("");
      return;
    }
    onChange([...tags, nextName]);
    setDraft("");
    setHighlight(0);
    inputRef.current?.focus();
    setOpen(true);
  };

  const removeTag = (name: string) => {
    const lower = name.toLowerCase();
    onChange(tags.filter((t) => t.toLowerCase() !== lower));
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setDraft("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      setHighlight((h) => (h + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (options.length === 0) return;
      setHighlight((h) => (h - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      const choice = options[highlight] ?? options[0];
      if (choice) commitTag(choice.value);
      else if (allowCreate) commitTag(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      removeTag(tags[tags.length - 1]!);
    }
  };

  return (
    <div
      ref={rootRef}
      className={["tag-chips-input", className].filter(Boolean).join(" ")}
    >
      <div
        className="page-tags-chips tag-chips-input-box"
        role="list"
        aria-label={ariaLabel}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag.toLowerCase()}
            className={["page-tag-chip", chipClassName].filter(Boolean).join(" ")}
            role="listitem"
          >
            <span className="page-tag-chip-label">{tag}</span>
            <button
              type="button"
              className="page-tag-chip-remove"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => removeTag(tag)}
            >
              ×
            </button>
          </span>
        ))}
        <div className="tag-chips-input-field-wrap">
          <input
            ref={inputRef}
            className="tag-chips-input-field"
            value={draft}
            disabled={disabled}
            placeholder={tags.length === 0 ? placeholder : ""}
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onFocus={() => {
              setOpen(true);
              setHighlight(0);
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              setOpen(true);
              setHighlight(0);
            }}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          {open ? (
            <div className="page-tags-popover tag-chips-input-popover" role="listbox">
              {options.length > 0 ? (
                <ul id={listId} className="page-tags-suggestions" role="listbox">
                  {options.map((opt, index) => (
                    <li key={`${opt.kind}:${opt.value.toLowerCase()}`} role="none">
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === highlight}
                        className={
                          index === highlight
                            ? "page-tags-suggestion is-active"
                            : "page-tags-suggestion"
                        }
                        onMouseEnter={() => setHighlight(index)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commitTag(opt.value)}
                      >
                        {opt.kind === "create" ? (
                          <>
                            Create <strong>{opt.value}</strong>
                          </>
                        ) : (
                          opt.value
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : draft.trim() ? (
                <div className="page-tags-empty">No matches</div>
              ) : (
                <div className="page-tags-empty">Type to filter tags</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

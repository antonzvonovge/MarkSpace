import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { placeAnchoredMenu } from "../lib/menuPlacement";
import { pastelChipStyle } from "../lib/pastelChipColors";
import { sanitizeTagName } from "../lib/tagName";
import { useVaultStore } from "../store/vaultStore";

export type TagChipsInputProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  /**
   * When set, used as the suggestion catalog instead of vault note/PDF tags
   * (e.g. dictionary tag bank for `.mddict`, or task labels).
   */
  catalog?: string[];
  /** Extra tag names merged with the base catalog (e.g. tags from the open .mdlnks file). */
  extraCatalog?: string[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Extra class on each chip (e.g. filter accent). */
  chipClassName?: string;
  /**
   * Per-name light matte Material pastel chips (stable hash).
   * Default keeps the shared blue `--tag-*` palette.
   */
  pastelChips?: boolean;
  /** Allow creating a brand-new tag from the draft (default true). */
  allowCreate?: boolean;
  /** Max suggestions shown (default 12). */
  maxSuggestions?: number;
  disabled?: boolean;
  /** Focus the input when mounted / when this becomes true. */
  autoFocus?: boolean;
  /**
   * Render the suggestion popover in a portal with fixed positioning
   * (needed when the parent clips overflow, e.g. dictionary grid cells).
   */
  portalPopover?: boolean;
  /** Called when Enter is pressed while the draft is empty (no commit). */
  onEmptyEnter?: () => void;
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
  catalog: catalogOverride,
  extraCatalog = [],
  placeholder = "Add tag…",
  ariaLabel = "Tags",
  className,
  chipClassName,
  pastelChips = false,
  allowCreate = true,
  maxSuggestions = 12,
  disabled = false,
  autoFocus = false,
  portalPopover = false,
  onEmptyEnter,
}: TagChipsInputProps) {
  const listId = useId();
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldWrapRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popoverPos, setPopoverPos] = useState<{
    top: number | null;
    bottom: number | null;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const baseCatalog = catalogOverride ?? vaultTags;
  const catalog = useMemo(
    () => mergeCatalog(baseCatalog, extraCatalog),
    [baseCatalog, extraCatalog],
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
    if (!autoFocus || disabled) return;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      setOpen(true);
      setHighlight(0);
    });
    return () => window.cancelAnimationFrame(id);
  }, [autoFocus, disabled]);

  useLayoutEffect(() => {
    if (!open || !portalPopover) {
      setPopoverPos(null);
      return;
    }
    const update = () => {
      const el = fieldWrapRef.current ?? inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(260, Math.max(180, r.width));
      const placed = placeAnchoredMenu(r, {
        gap: 4,
        width,
        maxHeight: 220,
        minHeight: 100,
        prefer: "below",
      });
      setPopoverPos({
        top: placed.top,
        bottom: placed.bottom,
        left: placed.left,
        width: placed.width,
        maxHeight: placed.maxHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, portalPopover, draft, tags.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (portalRef.current?.contains(target)) return;
      setOpen(false);
      setDraft("");
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
      if (event.key === "Enter" && !normalizeDraft(draft)) {
        onEmptyEnter?.();
        return;
      }
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

  const popover =
    open && (!portalPopover || popoverPos) ? (
    <div
      ref={portalPopover ? portalRef : undefined}
      className={
        portalPopover
          ? "page-tags-popover tag-chips-input-popover tag-chips-input-portal"
          : "page-tags-popover tag-chips-input-popover"
      }
      role="listbox"
      style={
        portalPopover && popoverPos
          ? {
              position: "fixed",
              top: popoverPos.top ?? undefined,
              bottom: popoverPos.bottom ?? undefined,
              left: popoverPos.left,
              width: popoverPos.width,
              maxHeight: popoverPos.maxHeight,
              right: "auto",
              zIndex: 10050,
            }
          : undefined
      }
    >
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
  ) : null;

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
            style={pastelChips ? pastelChipStyle(tag) : undefined}
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
        <div className="tag-chips-input-field-wrap" ref={fieldWrapRef}>
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
          {!portalPopover ? popover : null}
        </div>
      </div>
      {portalPopover && popover
        ? createPortal(popover, document.body)
        : null}
    </div>
  );
}

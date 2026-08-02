import { useEffect, useMemo, useRef, useState } from "react";
import { getFileTags, setFileTags } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";

type Props = {
  path: string;
};

function normalizeDraft(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("#")) t = t.slice(1).trim();
  return t;
}

/** Tag chips for PDF / filemeta-backed documents. */
export function PdfDocumentTags({ path }: Props) {
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const refreshVaultTags = useVaultStore((s) => s.refreshVaultTags);
  const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getFileTags(path);
        if (!cancelled) setTags(next);
      } catch {
        if (!cancelled) setTags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const suggestions = useMemo(() => {
    const q = normalizeDraft(draft).toLowerCase();
    const active = new Set(tags.map((t) => t.toLowerCase()));
    return vaultTags
      .filter((t) => !active.has(t.toLowerCase()))
      .filter((t) => !q || t.toLowerCase().includes(q))
      .slice(0, 12);
  }, [draft, tags, vaultTags]);

  const canCreate = useMemo(() => {
    const name = normalizeDraft(draft);
    if (!name) return false;
    const lower = name.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) return false;
    if (suggestions.some((t) => t.toLowerCase() === lower)) return false;
    return true;
  }, [draft, suggestions, tags]);

  const options = useMemo(() => {
    const list: { kind: "existing" | "create"; value: string }[] = suggestions.map(
      (value) => ({ kind: "existing" as const, value }),
    );
    if (canCreate) {
      list.push({ kind: "create", value: normalizeDraft(draft) });
    }
    return list;
  }, [canCreate, draft, suggestions]);

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setDraft("");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        setDraft("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (highlight >= options.length) setHighlight(Math.max(0, options.length - 1));
  }, [highlight, options.length]);

  const persist = async (next: string[]) => {
    setSaving(true);
    try {
      const saved = await setFileTags(path, next);
      setTags(saved);
      await refreshVaultTags();
    } catch {
      // keep previous chips; user can retry
    } finally {
      setSaving(false);
    }
  };

  const commitTag = (name: string) => {
    const nextName = normalizeDraft(name);
    if (!nextName || saving) return;
    const lower = nextName.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) {
      setDraft("");
      return;
    }
    void persist([...tags, nextName]);
    setDraft("");
  };

  const removeTag = (name: string) => {
    if (saving) return;
    const lower = name.toLowerCase();
    void persist(tags.filter((t) => t.toLowerCase() !== lower));
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlight((h) => (h + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      setHighlight((h) => (h - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const choice = options[highlight] ?? options[0];
      if (choice) commitTag(choice.value);
      else commitTag(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      event.preventDefault();
      removeTag(tags[tags.length - 1]!);
    }
  };

  return (
    <div className="page-tags pdf-document-tags" ref={rootRef}>
      <div className="page-tags-chips" role="list" aria-label="Document tags">
        {tags.map((tag) => (
          <span key={tag.toLowerCase()} className="page-tag-chip" role="listitem">
            <span className="page-tag-chip-label">{tag}</span>
            <button
              type="button"
              className="page-tag-chip-remove"
              aria-label={`Remove tag ${tag}`}
              disabled={saving}
              onClick={() => removeTag(tag)}
            >
              ×
            </button>
          </span>
        ))}
        <div className="page-tags-add-wrap">
          <button
            type="button"
            className={
              tags.length === 0 ? "page-tags-add is-empty" : "page-tags-add"
            }
            aria-label="Add tag"
            aria-expanded={open}
            aria-haspopup="listbox"
            disabled={saving}
            onClick={() => setOpen((v) => !v)}
          >
            {tags.length === 0 ? "Add tag" : "+"}
          </button>
          {open ? (
            <div className="page-tags-popover" role="dialog" aria-label="Add tag">
              <input
                ref={inputRef}
                className="page-tags-input"
                value={draft}
                placeholder="Search or create…"
                aria-autocomplete="list"
                aria-controls="pdf-tags-suggestions"
                onChange={(e) => {
                  setDraft(e.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onInputKeyDown}
              />
              {options.length > 0 ? (
                <ul
                  id="pdf-tags-suggestions"
                  className="page-tags-suggestions"
                  role="listbox"
                >
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
                <div className="page-tags-empty">Type to add a tag</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

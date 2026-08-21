import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePersistedEditorScroll } from "../../hooks/usePersistedEditorScroll";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ConfirmDialog,
  LinkItemDialog,
  type LinkItemDialogValue,
} from "../../components/AppDialog";
import { TagChipsInput } from "../../components/TagChipsInput";
import { useListReorder } from "../../hooks/useListReorder";
import {
  collectMdlnksTags,
  parseMdlnks,
  serializeMdlnks,
  type MdlnksDoc,
  type MdlnksItem,
} from "../../lib/mdlnksFormat";

type Props = {
  path: string;
  content: string;
  onChange: (next: string) => void;
};

type DialogState =
  | { mode: "add" }
  | { mode: "edit"; index: number }
  | null;

function safeParse(content: string): { doc: MdlnksDoc; error: string | null } {
  try {
    return { doc: parseMdlnks(content), error: null };
  } catch (e) {
    return {
      doc: { filter: [], items: [] },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function itemMatchesQuery(item: MdlnksItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.url.toLowerCase().includes(q)) return true;
  if (item.description.toLowerCase().includes(q)) return true;
  return item.tags.some((t) => t.toLowerCase().includes(q));
}

/** Wrap case-insensitive substring matches in a yellow highlight mark. */
function highlightMatches(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q || !text) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let key = 0;
  let idx = lower.indexOf(needle, start);
  while (idx !== -1) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(
      <mark key={key} className="links-editor-search-hit">
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    key += 1;
    start = idx + needle.length;
    idx = lower.indexOf(needle, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : parts;
}

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 4h6M5 8h6M5 12h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LinksEditor({ path, content, onChange }: Props) {
  const { doc, error } = useMemo(() => safeParse(content), [content]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  usePersistedEditorScroll(scrollEl, path, "live");

  const emit = useCallback(
    (next: MdlnksDoc) => {
      onChange(serializeMdlnks(next));
    },
    [onChange],
  );

  const allTags = useMemo(() => collectMdlnksTags(doc.items), [doc.items]);

  const visibleToAbsolute = useMemo(() => {
    const need =
      doc.filter.length > 0
        ? doc.filter.map((t) => t.toLowerCase())
        : null;
    const map: number[] = [];
    doc.items.forEach((item, i) => {
      if (need) {
        const have = new Set(item.tags.map((t) => t.toLowerCase()));
        if (!need.every((t) => have.has(t))) return;
      }
      if (!itemMatchesQuery(item, searchQuery)) return;
      map.push(i);
    });
    return map;
  }, [doc.filter, doc.items, searchQuery]);

  const visibleItems = useMemo(
    () => visibleToAbsolute.map((i) => doc.items[i]!),
    [doc.items, visibleToAbsolute],
  );

  const reorderVisible = useCallback(
    (fromVis: number, toVis: number) => {
      const visibleSet = new Set(visibleToAbsolute);
      const visibleOrdered = visibleToAbsolute.map((i) => doc.items[i]!);
      const [visMoved] = visibleOrdered.splice(fromVis, 1);
      if (!visMoved) return;
      visibleOrdered.splice(toVis, 0, visMoved);
      let vi = 0;
      const rebuilt: MdlnksItem[] = [];
      for (let i = 0; i < doc.items.length; i++) {
        if (visibleSet.has(i)) {
          rebuilt.push(visibleOrdered[vi]!);
          vi += 1;
        } else {
          rebuilt.push(doc.items[i]!);
        }
      }
      emit({ ...doc, items: rebuilt });
    },
    [doc, emit, visibleToAbsolute],
  );

  const bindReorder = useListReorder(visibleItems.length, reorderVisible);

  const setFilter = (tags: string[]) => {
    emit({ ...doc, filter: tags });
  };

  const onDialogConfirm = (value: LinkItemDialogValue) => {
    if (!dialog) return;
    if (dialog.mode === "add") {
      emit({
        ...doc,
        items: [
          ...doc.items,
          {
            url: value.url,
            description: value.description,
            tags: value.tags,
          },
        ],
      });
    } else {
      const nextItems = [...doc.items];
      nextItems[dialog.index] = {
        url: value.url,
        description: value.description,
        tags: value.tags,
      };
      emit({ ...doc, items: nextItems });
    }
    setDialog(null);
  };

  const confirmDelete = () => {
    if (deleteIndex == null) return;
    emit({
      ...doc,
      items: doc.items.filter((_, i) => i !== deleteIndex),
    });
    setDeleteIndex(null);
  };

  const editInitial = useMemo((): LinkItemDialogValue | undefined => {
    if (!dialog || dialog.mode !== "edit") return undefined;
    const item = doc.items[dialog.index];
    if (!item) return undefined;
    return {
      url: item.url,
      description: item.description,
      tags: item.tags,
    };
  }, [dialog, doc.items]);

  if (error) {
    return (
      <div className="links-editor-column">
        <div className="links-editor" ref={setScrollEl}>
          <div className="links-editor-error">
            <h2>Invalid links file</h2>
            <p>{error}</p>
            <p className="links-editor-error-hint">
              Switch to Source to fix the file, or recreate it. Expected header:{" "}
              <code># MarkSpace links v1</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="links-editor-column">
      <div className="links-editor" ref={setScrollEl}>
        <div className="links-editor-toolbar">
          <div className="links-editor-filter">
            <span className="links-editor-filter-label">Filter</span>
            <TagChipsInput
              tags={doc.filter}
              onChange={setFilter}
              extraCatalog={allTags}
              placeholder="Filter by tag…"
              ariaLabel="Filter tags"
              chipClassName="is-filter-active"
              className="links-editor-filter-chips"
            />
          </div>
          <div className="links-editor-search">
            <label className="links-editor-filter-label" htmlFor="links-search">
              Search
            </label>
            <input
              id="links-search"
              type="search"
              className="links-editor-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find in links…"
              aria-label="Search links"
            />
          </div>
          <button
            type="button"
            className="links-editor-add-btn"
            onClick={() => setDialog({ mode: "add" })}
          >
            Add link
          </button>
        </div>

        {doc.items.length === 0 ? (
          <div className="links-editor-empty">
            <h2>No links yet</h2>
            <p>Collect URLs with a short description and tags.</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="links-editor-empty">
            <h2>No matches</h2>
            <p>
              {searchQuery.trim()
                ? "No links match the current search and filters."
                : "No links have all of the selected filter tags."}
            </p>
            <button
              type="button"
              className="app-dialog-btn"
              onClick={() => {
                setFilter([]);
                setSearchQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <ul className="links-editor-list">
            {visibleItems.map((item, visIndex) => {
              const absIndex = visibleToAbsolute[visIndex]!;
              const bind = bindReorder(visIndex);
              return (
                <li
                  key={`${absIndex}:${item.url}`}
                  className={`links-editor-row ${bind.className}`}
                  draggable={bind.draggable}
                  onDragStart={bind.onDragStart}
                  onDragEnd={bind.onDragEnd}
                  onDragOver={bind.onDragOver}
                  onDragLeave={bind.onDragLeave}
                  onDrop={bind.onDrop}
                >
                  <span className="links-editor-drag" title="Drag to reorder">
                    <DragHandleIcon />
                  </span>
                  <div className="links-editor-row-main">
                    <div className="links-editor-row-head">
                      <a
                        className="links-editor-url"
                        href={item.url}
                        onClick={(e) => {
                          e.preventDefault();
                          if (bind.shouldIgnoreClick()) return;
                          void openUrl(item.url);
                        }}
                      >
                        {highlightMatches(item.url, searchQuery)}
                      </a>
                      <div className="links-editor-row-actions">
                        <button
                          type="button"
                          className="links-editor-icon-btn"
                          title="Edit"
                          aria-label="Edit link"
                          onClick={() =>
                            setDialog({ mode: "edit", index: absIndex })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="links-editor-icon-btn is-danger"
                          title="Delete"
                          aria-label="Delete link"
                          onClick={() => setDeleteIndex(absIndex)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {item.description ? (
                      <p className="links-editor-desc">
                        {highlightMatches(item.description, searchQuery)}
                      </p>
                    ) : null}
                    {item.tags.length > 0 ? (
                      <div className="page-tags-chips">
                        {item.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="page-tag-chip links-editor-tag-btn"
                            title={`Filter by ${tag}`}
                            onClick={() => {
                              if (
                                !doc.filter.some(
                                  (t) => t.toLowerCase() === tag.toLowerCase(),
                                )
                              ) {
                                setFilter([...doc.filter, tag]);
                              }
                            }}
                          >
                            <span className="page-tag-chip-label">
                              {highlightMatches(tag, searchQuery)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <LinkItemDialog
          open={dialog !== null}
          title={dialog?.mode === "edit" ? "Edit link" : "Add link"}
          confirmLabel={dialog?.mode === "edit" ? "Save" : "Add"}
          initial={editInitial}
          suggestedTags={allTags}
          onCancel={() => setDialog(null)}
          onConfirm={onDialogConfirm}
        />

        <ConfirmDialog
          open={deleteIndex !== null}
          title="Delete link"
          description={
            deleteIndex != null
              ? `Remove ${doc.items[deleteIndex]?.url ?? "this link"} from the list?`
              : ""
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteIndex(null)}
          onConfirm={confirmDelete}
        />
      </div>
    </div>
  );
}

import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { moviesProjectRootForPath } from "../lib/diaryNotes";
import {
  MOVIE_KIND_OPTIONS,
  movieRatingLabel,
  movieRatingRank,
} from "../lib/movieNotes";
import {
  collectCatalogGenres,
  emptyMediaCatalogFilters,
  filterMediaCatalogEntries,
  loadMediaCatalogEntries,
  type MediaCatalogEntry,
  type MediaCatalogFilters,
} from "../lib/mediaCatalogIndex";
import {
  absolutePath,
  folderPathFromFolderNote,
  type ProjectProperties,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import { NewFilmDialog } from "./MovieDialogs";
import { Select } from "./ui/Select";

type Props = {
  folder: string;
};

/** Resolve Media library folder from an open `.folder.md` path, or null. */
export function mediaCatalogFolderForPath(
  path: string,
  projectPropertiesByPath: Record<string, ProjectProperties>,
): string | null {
  const folder = folderPathFromFolderNote(path);
  if (folder == null || folder === "") return null;
  if (moviesProjectRootForPath(folder, projectPropertiesByPath) == null) {
    return null;
  }
  return folder;
}

function folderLabel(folder: string): string {
  if (!folder) return "Vault";
  const parts = folder.split("/");
  return parts[parts.length - 1] || folder;
}

function PosterImg({ vaultPath }: { vaultPath: string | null }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!vaultPath) {
      setSrc(null);
      return;
    }
    void absolutePath(vaultPath)
      .then((abs) => {
        if (!cancelled) setSrc(convertFileSrc(abs));
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  if (!src) {
    return <span className="media-catalog-poster is-empty" aria-hidden="true" />;
  }
  return (
    <img
      className="media-catalog-poster"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

function Tile({
  entry,
  onOpen,
}: {
  entry: MediaCatalogEntry;
  onOpen: (path: string) => void;
}) {
  const rating = entry.rating ? movieRatingLabel(entry.rating) : null;

  const subtitle =
    entry.originalTitle && entry.originalTitle !== entry.title
      ? entry.originalTitle
      : null;

  return (
    <button
      type="button"
      className="media-catalog-tile"
      onClick={() => onOpen(entry.path)}
    >
      <PosterImg vaultPath={entry.posterVaultPath} />
      <span className="media-catalog-tile-body">
        <span className="media-catalog-tile-headline">
          <span className="media-catalog-tile-title">{entry.title}</span>
          {entry.year != null ? (
            <span className="media-catalog-tile-year">{entry.year}</span>
          ) : null}
        </span>
        {subtitle ? (
          <span className="media-catalog-tile-orig">{subtitle}</span>
        ) : null}
        {rating ? (
          <span className="media-catalog-tile-meta">{rating}</span>
        ) : null}
        {entry.commentPreview ? (
          <span className="media-catalog-tile-comment">
            {entry.commentPreview}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function MediaCatalogView({ folder }: Props) {
  const tree = useVaultStore((s) => s.tree);
  const openNote = useVaultStore((s) => s.openNote);
  const createFilmNote = useVaultStore((s) => s.createFilmNote);

  const [entries, setEntries] = useState<MediaCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<MediaCatalogFilters>(() =>
    emptyMediaCatalogFilters(),
  );
  const [sort, setSort] = useState<
    "title" | "year" | "rating" | "watched"
  >("title");
  const [newFilmOpen, setNewFilmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadMediaCatalogEntries(tree, folder).then((next) => {
      if (cancelled) return;
      setEntries(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tree, folder]);

  const allGenres = useMemo(() => collectCatalogGenres(entries), [entries]);

  const visible = useMemo(() => {
    const filtered = filterMediaCatalogEntries(entries, filters);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "year") {
        const ay = a.year ?? 0;
        const by = b.year ?? 0;
        if (ay !== by) return by - ay;
      } else if (sort === "rating") {
        const ar = movieRatingRank(a.rating);
        const br = movieRatingRank(b.rating);
        if (ar !== br) return br - ar;
      } else if (sort === "watched") {
        const al = a.watched[a.watched.length - 1] ?? "";
        const bl = b.watched[b.watched.length - 1] ?? "";
        if (al !== bl) return bl.localeCompare(al);
        if (a.watched.length !== b.watched.length) {
          return b.watched.length - a.watched.length;
        }
      }
      return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    });
    return sorted;
  }, [entries, filters, sort]);

  const openFilm = (path: string) => {
    void openNote(path, { preview: true });
  };

  return (
    <div className="media-catalog">
      <header className="media-catalog-header">
        <div className="media-catalog-header-text">
          <h1 className="media-catalog-title">{folderLabel(folder)}</h1>
          <p className="media-catalog-sub">
            {loading
              ? "Loading…"
              : `${visible.length} of ${entries.length} title${entries.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          className="app-dialog-btn is-primary"
          onClick={() => setNewFilmOpen(true)}
        >
          New film…
        </button>
      </header>

      <div className="media-catalog-toolbar" role="group" aria-label="Catalog filters">
        <input
          type="search"
          className="media-catalog-search"
          value={filters.query}
          onChange={(e) =>
            setFilters((f) => ({ ...f, query: e.target.value }))
          }
          placeholder="Search…"
          aria-label="Search catalog"
        />
        <Select
          value={filters.kind}
          options={[
            { value: "", label: "All kinds" },
            ...MOVIE_KIND_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            })),
          ]}
          onChange={(v) =>
            setFilters((f) => ({
              ...f,
              kind: v as MediaCatalogFilters["kind"],
            }))
          }
          variant="setting"
          className="media-catalog-select"
          aria-label="Kind"
        />
        <Select
          value={filters.genre}
          options={[
            { value: "", label: "All genres" },
            ...allGenres.map((g) => ({ value: g, label: g })),
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, genre: v }))}
          variant="setting"
          className="media-catalog-select"
          aria-label="Genre"
          disabled={allGenres.length === 0}
        />
        <Select
          value={sort}
          options={[
            { value: "title", label: "Title" },
            { value: "year", label: "Year" },
            { value: "rating", label: "Rating" },
            { value: "watched", label: "Last watched" },
          ]}
          onChange={(v) =>
            setSort(v as "title" | "year" | "rating" | "watched")
          }
          variant="setting"
          className="media-catalog-select"
          aria-label="Sort"
        />
      </div>

      {loading ? (
        <div className="media-catalog-empty">Loading catalog…</div>
      ) : visible.length === 0 ? (
        <div className="media-catalog-empty">
          {entries.length === 0
            ? "No films in this folder yet. Add one with New film…"
            : "No titles match the current filters."}
        </div>
      ) : (
        <div className="media-catalog-grid">
          {visible.map((entry) => (
            <Tile key={entry.path} entry={entry} onOpen={openFilm} />
          ))}
        </div>
      )}

      <NewFilmDialog
        open={newFilmOpen}
        onCancel={() => setNewFilmOpen(false)}
        onConfirm={(value) => {
          setNewFilmOpen(false);
          void createFilmNote(folder, value);
        }}
      />
    </div>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import {
  MOVIE_KIND_OPTIONS,
  MOVIE_STATUS_OPTIONS,
  filmNoteFileStem,
  type MovieKindId,
  type MovieStatusId,
} from "../lib/movieNotes";
import type { MovieAttrs } from "../lib/noteFrontmatter";
import {
  getMovieCatalogDetails,
  searchMovieCatalog,
  type CatalogSearchHit,
} from "../lib/movieCatalog";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { TagChipsInput } from "./TagChipsInput";
import { DialogShell } from "./AppDialog";
import { Select } from "./ui/Select";

const RATING_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "—" },
  ...Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1);
    return { value: n, label: n };
  }),
];

const KIND_SELECT_OPTIONS: { value: MovieKindId; label: string }[] =
  MOVIE_KIND_OPTIONS;

const STATUS_SELECT_OPTIONS: { value: MovieStatusId | ""; label: string }[] = [
  { value: "", label: "—" },
  ...MOVIE_STATUS_OPTIONS,
];

function hitSubtitle(hit: CatalogSearchHit): string {
  const parts = [hit.year != null ? String(hit.year) : null, hit.type];
  if (hit.originalTitle && hit.originalTitle !== hit.title) {
    parts.push(hit.originalTitle);
  }
  return parts.filter(Boolean).join(" · ");
}

export type MoviePropertiesDialogValue = MovieAttrs & {
  posterUrl: string;
};

type MoviePropertiesDialogProps = {
  open: boolean;
  title?: string;
  initial: MovieAttrs;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: MoviePropertiesDialogValue) => void;
};

export function MoviePropertiesDialog({
  open,
  title = "Movie properties",
  initial,
  confirmLabel = "Save",
  onCancel,
  onConfirm,
}: MoviePropertiesDialogProps) {
  const yearId = useId();
  const directorId = useId();
  const titleFieldId = useId();
  const originalId = useId();
  const posterId = useId();
  const queryId = useId();
  const omdbKey = useAiSettingsStore((s) => s.settings.omdbApiKey.trim());
  const kpKey = useAiSettingsStore((s) => s.settings.kinopoiskApiKey.trim());
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);

  const [kind, setKind] = useState<MovieKindId>(initial.kind || "film");
  const [genres, setGenres] = useState<string[]>(initial.genres);
  const [year, setYear] = useState(initial.year != null ? String(initial.year) : "");
  const [rating, setRating] = useState(
    initial.rating != null ? String(initial.rating) : "",
  );
  const [director, setDirector] = useState(initial.director);
  const [status, setStatus] = useState<MovieStatusId | "">(initial.status);
  const [movieTitle, setMovieTitle] = useState(initial.title);
  const [originalTitle, setOriginalTitle] = useState(initial.originalTitle);
  const [imdbId, setImdbId] = useState(initial.imdbId);
  const [kinopoiskId, setKinopoiskId] = useState<number | null>(
    initial.kinopoiskId,
  );
  const [posterUrl, setPosterUrl] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<CatalogSearchHit[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const canLookup = Boolean(kpKey || omdbKey);

  useEffect(() => {
    if (!open) return;
    setKind(initial.kind || "film");
    setGenres(initial.genres);
    setYear(initial.year != null ? String(initial.year) : "");
    setRating(initial.rating != null ? String(initial.rating) : "");
    setDirector(initial.director);
    setStatus(initial.status);
    setMovieTitle(initial.title);
    setOriginalTitle(initial.originalTitle);
    setImdbId(initial.imdbId);
    setKinopoiskId(initial.kinopoiskId);
    setPosterUrl("");
    setQuery("");
    setHits([]);
    setLookupError(null);
  }, [open, initial]);

  const submit = () => {
    const y = year.trim() ? Number(year.trim()) : null;
    const r = rating.trim() ? Number(rating.trim()) : null;
    onConfirm({
      title: movieTitle.trim(),
      originalTitle: originalTitle.trim(),
      kind,
      genres,
      year: y != null && Number.isFinite(y) && y > 0 ? Math.round(y) : null,
      rating:
        r != null && Number.isFinite(r) && r >= 1 && r <= 10
          ? Math.round(r)
          : null,
      director: director.trim(),
      status,
      imdbId,
      kinopoiskId,
      posterUrl: posterUrl.trim(),
    });
  };

  const onLookup = async () => {
    if (lookingUp) return;
    const q = query.trim();
    if (!q) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const result = await searchMovieCatalog({
        query: q,
        kind,
        nativeLanguage,
        kinopoiskApiKey: kpKey,
        omdbApiKey: omdbKey,
      });
      setHits(result.hits);
      if (result.hits.length === 0) setLookupError("No results.");
    } catch (e) {
      setHits([]);
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookingUp(false);
    }
  };

  const onPickHit = async (hit: CatalogSearchHit) => {
    if (lookingUp) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const details = await getMovieCatalogDetails({
        hit,
        kinopoiskApiKey: kpKey,
        omdbApiKey: omdbKey,
      });
      setMovieTitle(details.title);
      setOriginalTitle(details.originalTitle);
      setYear(details.year != null ? String(details.year) : "");
      setDirector(details.director);
      setGenres(details.genres);
      setImdbId(details.imdbId);
      setKinopoiskId(details.kinopoiskId);
      if (details.posterUrl) setPosterUrl(details.posterUrl);
      setHits([]);
      setQuery(details.title);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookingUp(false);
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
            disabled={lookingUp}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="app-dialog-body movie-dialog-body">
        <label className="app-dialog-label">Kind</label>
        <Select
          value={kind}
          options={KIND_SELECT_OPTIONS}
          onChange={setKind}
          variant="field"
          aria-label="Kind"
          disabled={lookingUp}
        />

        <span className="app-dialog-label">Genres</span>
        <TagChipsInput
          tags={genres}
          onChange={setGenres}
          catalog={genres}
          placeholder="Add genre…"
          ariaLabel="Genres"
          disabled={lookingUp}
        />

        <label className="app-dialog-label">Status</label>
        <Select
          value={status}
          options={STATUS_SELECT_OPTIONS}
          onChange={setStatus}
          variant="field"
          aria-label="Status"
          disabled={lookingUp}
        />

        <div className="movie-dialog-row">
          <div>
            <label className="app-dialog-label" htmlFor={yearId}>
              Year
            </label>
            <input
              id={yearId}
              className="app-dialog-input"
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2010"
              disabled={lookingUp}
            />
          </div>
          <div>
            <label className="app-dialog-label">Rating</label>
            <Select
              value={rating}
              options={RATING_OPTIONS}
              onChange={setRating}
              variant="field"
              aria-label="Rating"
              disabled={lookingUp}
            />
          </div>
        </div>

        <label className="app-dialog-label" htmlFor={directorId}>
          Director
        </label>
        <input
          id={directorId}
          className="app-dialog-input"
          value={director}
          onChange={(e) => setDirector(e.target.value)}
          placeholder="Director or creator"
          disabled={lookingUp}
        />

        <label className="app-dialog-label" htmlFor={titleFieldId}>
          Title
        </label>
        <input
          id={titleFieldId}
          className="app-dialog-input"
          value={movieTitle}
          onChange={(e) => setMovieTitle(e.target.value)}
          placeholder="Title in your language"
          disabled={lookingUp}
        />

        <label className="app-dialog-label" htmlFor={originalId}>
          Original title
        </label>
        <input
          id={originalId}
          className="app-dialog-input"
          value={originalTitle}
          onChange={(e) => setOriginalTitle(e.target.value)}
          placeholder="Title in the original language"
          disabled={lookingUp}
        />

        <label className="app-dialog-label" htmlFor={posterId}>
          Poster URL
        </label>
        <input
          id={posterId}
          className="app-dialog-input"
          value={posterUrl}
          onChange={(e) => setPosterUrl(e.target.value)}
          placeholder="https://… (optional — downloads into .assets)"
          spellCheck={false}
          disabled={lookingUp}
        />

        <label className="app-dialog-label" htmlFor={queryId}>
          Lookup
        </label>
        <div className="link-dialog-url-row">
          <input
            id={queryId}
            className="app-dialog-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onLookup();
              }
            }}
            placeholder={
              canLookup
                ? "Title in your language or original…"
                : "Add Kinopoisk (RU) or OMDb key in Settings → Media library"
            }
            disabled={lookingUp}
          />
          <button
            type="button"
            className="app-dialog-btn link-dialog-suggest-btn"
            disabled={!query.trim() || lookingUp}
            onClick={() => void onLookup()}
          >
            {lookingUp ? "…" : "Lookup"}
          </button>
        </div>
        {lookupError ? (
          <p className="link-dialog-suggest-error" role="alert">
            {lookupError}
          </p>
        ) : null}
        {hits.length > 0 ? (
          <ul className="movie-lookup-results" role="listbox" aria-label="Search results">
            {hits.map((hit) => (
              <li key={`${hit.provider}-${hit.id}`}>
                <button
                  type="button"
                  className="movie-lookup-hit"
                  disabled={lookingUp}
                  onClick={() => void onPickHit(hit)}
                >
                  {hit.posterUrl ? (
                    <img src={hit.posterUrl} alt="" className="movie-lookup-thumb" />
                  ) : (
                    <span className="movie-lookup-thumb is-empty" />
                  )}
                  <span className="movie-lookup-hit-meta">
                    <span className="movie-lookup-hit-title">{hit.title}</span>
                    <span className="movie-lookup-hit-sub">{hitSubtitle(hit)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DialogShell>
  );
}

export type NewFilmDialogResult = {
  title: string;
  attrs: MovieAttrs;
  posterUrl: string;
};

type NewFilmDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: (value: NewFilmDialogResult) => void;
};

export function NewFilmDialog({ open, onCancel, onConfirm }: NewFilmDialogProps) {
  const queryId = useId();
  const titleId = useId();
  const omdbKey = useAiSettingsStore((s) => s.settings.omdbApiKey.trim());
  const kpKey = useAiSettingsStore((s) => s.settings.kinopoiskApiKey.trim());
  const nativeLanguage = usePrefsStore((s) => s.prefs.nativeLanguage);
  const queryRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<MovieKindId>("film");
  const [status, setStatus] = useState<MovieStatusId | "">("favorite");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [director, setDirector] = useState("");
  const [originalTitle, setOriginalTitle] = useState("");
  const [imdbId, setImdbId] = useState("");
  const [kinopoiskId, setKinopoiskId] = useState<number | null>(null);
  const [posterUrl, setPosterUrl] = useState("");
  const [hits, setHits] = useState<CatalogSearchHit[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind("film");
    setStatus("favorite");
    setQuery("");
    setTitle("");
    setGenres([]);
    setYear(null);
    setDirector("");
    setOriginalTitle("");
    setImdbId("");
    setKinopoiskId(null);
    setPosterUrl("");
    setHits([]);
    setLookupError(null);
    const id = window.requestAnimationFrame(() => {
      queryRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  const onLookup = async () => {
    if (lookingUp) return;
    const q = query.trim();
    if (!q) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const result = await searchMovieCatalog({
        query: q,
        kind,
        nativeLanguage,
        kinopoiskApiKey: kpKey,
        omdbApiKey: omdbKey,
      });
      setHits(result.hits);
      if (result.hits.length === 0) setLookupError("No results.");
    } catch (e) {
      setHits([]);
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookingUp(false);
    }
  };

  const onPickHit = async (hit: CatalogSearchHit) => {
    if (lookingUp) return;
    setLookingUp(true);
    setLookupError(null);
    try {
      const details = await getMovieCatalogDetails({
        hit,
        kinopoiskApiKey: kpKey,
        omdbApiKey: omdbKey,
      });
      // Localized title for the note; original kept separately.
      setTitle(details.title);
      setQuery(details.title);
      setOriginalTitle(details.originalTitle);
      setYear(details.year);
      setDirector(details.director);
      setGenres(details.genres);
      setImdbId(details.imdbId);
      setKinopoiskId(details.kinopoiskId);
      if (details.posterUrl) setPosterUrl(details.posterUrl);
      setHits([]);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLookingUp(false);
    }
  };

  const submit = (blank: boolean) => {
    const name = blank
      ? query.trim() || title.trim()
      : title.trim() || query.trim();
    if (!name && !blank) return;
    onConfirm({
      title: name || "Untitled film",
      attrs: {
        title: name || "Untitled film",
        originalTitle: blank ? "" : originalTitle,
        kind,
        genres: blank ? [] : genres,
        year: blank ? null : year,
        rating: null,
        director: blank ? "" : director,
        status,
        imdbId: blank ? "" : imdbId,
        kinopoiskId: blank ? null : kinopoiskId,
      },
      posterUrl: blank ? "" : posterUrl,
    });
  };

  return (
    <DialogShell
      open={open}
      title="New film"
      onCancel={onCancel}
      wide
      footer={
        <>
          <button type="button" className="app-dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="app-dialog-btn"
            disabled={lookingUp}
            onClick={() => submit(true)}
          >
            Create blank
          </button>
          <button
            type="button"
            className="app-dialog-btn is-primary"
            disabled={lookingUp || !(title.trim() || query.trim())}
            onClick={() => submit(false)}
          >
            Create
          </button>
        </>
      }
    >
      <div className="app-dialog-body movie-dialog-body">
        <label className="app-dialog-label">Kind</label>
        <Select
          value={kind}
          options={KIND_SELECT_OPTIONS}
          onChange={setKind}
          variant="field"
          aria-label="Kind"
          disabled={lookingUp}
        />

        <label className="app-dialog-label">Status</label>
        <Select
          value={status}
          options={STATUS_SELECT_OPTIONS}
          onChange={setStatus}
          variant="field"
          aria-label="Status"
          disabled={lookingUp}
        />

        <label className="app-dialog-label" htmlFor={queryId}>
          Search
        </label>
        <div className="link-dialog-url-row">
          <input
            ref={queryRef}
            id={queryId}
            className="app-dialog-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onLookup();
              }
            }}
            placeholder="Title in your language or original…"
            disabled={lookingUp}
          />
          <button
            type="button"
            className="app-dialog-btn link-dialog-suggest-btn"
            disabled={!query.trim() || lookingUp}
            onClick={() => void onLookup()}
          >
            {lookingUp ? "…" : "Lookup"}
          </button>
        </div>
        {lookupError ? (
          <p className="link-dialog-suggest-error" role="alert">
            {lookupError}
          </p>
        ) : null}
        {hits.length > 0 ? (
          <ul className="movie-lookup-results" role="listbox" aria-label="Search results">
            {hits.map((hit) => (
              <li key={`${hit.provider}-${hit.id}`}>
                <button
                  type="button"
                  className="movie-lookup-hit"
                  disabled={lookingUp}
                  onClick={() => void onPickHit(hit)}
                >
                  {hit.posterUrl ? (
                    <img src={hit.posterUrl} alt="" className="movie-lookup-thumb" />
                  ) : (
                    <span className="movie-lookup-thumb is-empty" />
                  )}
                  <span className="movie-lookup-hit-meta">
                    <span className="movie-lookup-hit-title">{hit.title}</span>
                    <span className="movie-lookup-hit-sub">{hitSubtitle(hit)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="app-dialog-label" htmlFor={titleId}>
          Title
        </label>
        <input
          id={titleId}
          className="app-dialog-input"
          value={title || query}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title in your language"
          disabled={lookingUp}
        />

        {(year || director || originalTitle || genres.length > 0 || title || query) && (
          <p className="app-dialog-desc movie-dialog-preview">
            {[
              `File: ${filmNoteFileStem({
                title: title || query,
                originalTitle,
                year,
              })}.md`,
              year != null ? String(year) : null,
              originalTitle && originalTitle !== (title || query)
                ? `orig. ${originalTitle}`
                : null,
              director || null,
              genres.length ? genres.join(", ") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>
    </DialogShell>
  );
}

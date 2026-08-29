import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { MdVisibility } from "react-icons/md";
import { moviesProjectRootForPath } from "../lib/diaryNotes";
import {
  appendWatchedDate,
  formatMovieWatchedSummary,
  movieKindLabel,
  movieRatingLabel,
  resolveFilmPosterRel,
  withLeadingPoster,
} from "../lib/movieNotes";
import {
  getMovieAttrs,
  noteBody,
  setMovieAttrs,
  withNoteBody,
  type MovieAttrs,
} from "../lib/noteFrontmatter";
import { downloadPosterToAssets } from "../lib/omdb";
import {
  absolutePath,
  joinPath,
  parentPath,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import {
  MoviePropertiesDialog,
  type MoviePropertiesDialogValue,
} from "./MovieDialogs";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

function posterVaultPath(notePath: string, content: string): string | null {
  const attrs = getMovieAttrs(content);
  const rel = resolveFilmPosterRel(attrs.poster, noteBody(content));
  if (!rel) return null;
  const cleaned = rel.replace(/^\.\//, "");
  return joinPath(parentPath(notePath), cleaned);
}

function FilmPoster({ vaultPath }: { vaultPath: string | null }) {
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
    return (
      <span className="page-movie-card-poster is-empty" aria-hidden="true" />
    );
  }
  return (
    <img
      className="page-movie-card-poster"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

function DetailsBody({ attrs }: { attrs: MovieAttrs }) {
  const title = (attrs.title || attrs.originalTitle || "").trim();
  const original =
    attrs.originalTitle &&
    attrs.originalTitle.trim() &&
    attrs.originalTitle.trim() !== attrs.title.trim()
      ? attrs.originalTitle.trim()
      : null;
  const kindGenres = [
    attrs.kind ? movieKindLabel(attrs.kind) : null,
    attrs.genres.length ? attrs.genres.join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const countries = attrs.countries.length
    ? attrs.countries.join(", ")
    : null;
  const rating = attrs.rating ? movieRatingLabel(attrs.rating) : null;
  const director = (attrs.director || "").trim() || null;

  return (
    <>
      <span className="page-movie-card-headline">
        {title ? (
          <span className="page-movie-card-title">{title}</span>
        ) : (
          <span className="page-movie-card-title is-muted">Untitled</span>
        )}
        {attrs.year != null ? (
          <span className="page-movie-card-year">{attrs.year}</span>
        ) : null}
      </span>
      {original ? (
        <span className="page-movie-card-original">{original}</span>
      ) : null}
      {kindGenres ? (
        <span className="page-movie-card-line">{kindGenres}</span>
      ) : null}
      {countries ? (
        <span className="page-movie-card-line">{countries}</span>
      ) : null}
      {rating || director ? (
        <span className="page-movie-card-line page-movie-card-credits">
          {[rating, director].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </>
  );
}

export function PageMovieProps({ path, content, onChange }: Props) {
  const projectPropertiesByPath = useVaultStore(
    (s) => s.projectPropertiesByPath,
  );
  const inMovies = useMemo(
    () => moviesProjectRootForPath(path, projectPropertiesByPath) != null,
    [path, projectPropertiesByPath],
  );
  const attrs = useMemo(() => getMovieAttrs(content), [content]);
  const posterPath = useMemo(
    () => posterVaultPath(path, content),
    [path, content],
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!inMovies || !path.toLowerCase().endsWith(".md")) return null;

  const empty =
    !attrs.title &&
    !attrs.originalTitle &&
    !attrs.kind &&
    attrs.genres.length === 0 &&
    attrs.countries.length === 0 &&
    attrs.year == null &&
    !attrs.rating &&
    !attrs.director &&
    attrs.watched.length === 0 &&
    !posterPath;

  const watchedStats = formatMovieWatchedSummary(attrs.watched);

  const apply = async (value: MoviePropertiesDialogValue) => {
    setBusy(true);
    try {
      let next = setMovieAttrs(content, {
        title: value.title,
        originalTitle: value.originalTitle,
        kind: value.kind,
        genres: value.genres,
        countries: value.countries,
        year: value.year,
        rating: value.rating,
        director: value.director,
        imdbId: value.imdbId,
        kinopoiskId: value.kinopoiskId,
        poster: value.poster,
      });
      const poster = value.posterUrl.trim();
      if (poster) {
        const assetUrl = await downloadPosterToAssets(path, poster);
        next = setMovieAttrs(next, { poster: assetUrl });
        const body = withLeadingPoster(noteBody(next), assetUrl);
        next = withNoteBody(next, body);
      }
      onChange(next);
      setOpen(false);
    } catch (e) {
      useVaultStore.setState({
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const markWatched = () => {
    onChange(
      setMovieAttrs(content, {
        watched: appendWatchedDate(attrs.watched),
      }),
    );
  };

  return (
    <>
      <div className="page-movie-props">
        <div
          className={
            empty ? "page-movie-card is-empty" : "page-movie-card"
          }
        >
          {empty ? (
            <button
              type="button"
              className="page-movie-card-main"
              onClick={() => setOpen(true)}
              aria-label="Movie properties"
              title="Movie properties"
            >
              <FilmPoster vaultPath={posterPath} />
              <span className="page-movie-card-placeholder">
                Add movie details…
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                className="page-movie-card-poster-hit"
                onClick={() => setOpen(true)}
                aria-label="Movie properties"
                title="Movie properties"
              >
                <FilmPoster vaultPath={posterPath} />
              </button>
              <div className="page-movie-card-meta">
                <button
                  type="button"
                  className="page-movie-card-details"
                  onClick={() => setOpen(true)}
                  aria-label="Movie properties"
                  title="Movie properties"
                >
                  <DetailsBody attrs={attrs} />
                </button>
                <span className="page-movie-card-line page-movie-card-watched icon-text">
                  <button
                    type="button"
                    className="page-movie-watched-eye icon-text-glyph"
                    onClick={markWatched}
                    aria-label="I watched"
                    title="I watched"
                  >
                    <MdVisibility size={24} aria-hidden="true" />
                  </button>
                  {watchedStats ? (
                    <span className="page-movie-card-watched-stats">
                      {watchedStats}
                    </span>
                  ) : null}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      <MoviePropertiesDialog
        open={open}
        initial={attrs}
        confirmLabel={busy ? "Saving…" : "Save"}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={(v) => {
          void apply(v);
        }}
      />
    </>
  );
}

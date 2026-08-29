import { useMemo, useState } from "react";
import { moviesProjectRootForPath } from "../lib/diaryNotes";
import {
  movieKindLabel,
  movieStatusLabel,
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

function summarize(attrs: MovieAttrs): string {
  const parts: string[] = [];
  if (attrs.title) parts.push(attrs.title);
  if (attrs.originalTitle && attrs.originalTitle !== attrs.title) {
    parts.push(attrs.originalTitle);
  }
  if (attrs.kind) parts.push(movieKindLabel(attrs.kind));
  if (attrs.genres.length) parts.push(attrs.genres.join(", "));
  const line1 = parts.join(" · ");

  const line2Parts: string[] = [];
  if (attrs.status) {
    const star = attrs.status === "favorite" ? "★ " : "";
    line2Parts.push(`${star}${movieStatusLabel(attrs.status)}`);
  }
  if (attrs.year != null) line2Parts.push(String(attrs.year));
  if (attrs.rating != null) line2Parts.push(`${attrs.rating}/10`);
  if (attrs.director) line2Parts.push(attrs.director);
  const line2 = line2Parts.join("   ");

  return [line1, line2].filter(Boolean).join("\n");
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!inMovies || !path.toLowerCase().endsWith(".md")) return null;

  const summary = summarize(attrs);
  const empty = !summary.trim();

  const apply = async (value: MoviePropertiesDialogValue) => {
    setBusy(true);
    try {
      let next = setMovieAttrs(content, {
        title: value.title,
        originalTitle: value.originalTitle,
        kind: value.kind,
        genres: value.genres,
        year: value.year,
        rating: value.rating,
        director: value.director,
        status: value.status,
        imdbId: value.imdbId,
        kinopoiskId: value.kinopoiskId,
      });
      const poster = value.posterUrl.trim();
      if (poster) {
        const assetUrl = await downloadPosterToAssets(path, poster);
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

  return (
    <>
      <div className="page-movie-props">
        <button
          type="button"
          className={
            empty
              ? "page-movie-props-btn is-empty"
              : "page-movie-props-btn"
          }
          onClick={() => setOpen(true)}
          aria-label="Movie properties"
          title="Movie properties"
        >
          {empty ? (
            <span className="page-movie-props-placeholder">
              Add movie details…
            </span>
          ) : (
            <span className="page-movie-props-summary">
              {attrs.title || attrs.originalTitle ? (
                <span className="page-movie-props-line">
                  {[
                    attrs.title || null,
                    attrs.originalTitle &&
                    attrs.originalTitle !== attrs.title
                      ? attrs.originalTitle
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              {attrs.kind || attrs.genres.length > 0 ? (
                <span className="page-movie-props-line">
                  {[
                    attrs.kind ? movieKindLabel(attrs.kind) : null,
                    attrs.genres.length ? attrs.genres.join(", ") : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              ) : null}
              <span className="page-movie-props-line page-movie-props-meta">
                {[
                  attrs.status
                    ? `${attrs.status === "favorite" ? "★ " : ""}${movieStatusLabel(attrs.status)}`
                    : null,
                  attrs.year != null ? String(attrs.year) : null,
                  attrs.rating != null ? `${attrs.rating}/10` : null,
                  attrs.director || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          )}
        </button>
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

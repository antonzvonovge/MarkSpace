/** Media library project card helpers — kinds, statuses, note templates, poster body. */

export type MovieKindId = "film" | "series" | "animation";
export type MovieStatusId = "want" | "watched" | "favorite";

export const MOVIE_KIND_OPTIONS: { value: MovieKindId; label: string }[] = [
  { value: "film", label: "Film" },
  { value: "series", label: "Series" },
  { value: "animation", label: "Animation" },
];

export const MOVIE_STATUS_OPTIONS: { value: MovieStatusId; label: string }[] = [
  { value: "want", label: "Want to watch" },
  { value: "watched", label: "Watched" },
  { value: "favorite", label: "Favorite" },
];

export function isMovieKindId(value: unknown): value is MovieKindId {
  return value === "film" || value === "series" || value === "animation";
}

export function isMovieStatusId(value: unknown): value is MovieStatusId {
  return value === "want" || value === "watched" || value === "favorite";
}

/** Normalize IMDb id like `tt1375666`. */
export function normalizeImdbId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `tt${Math.round(value)}`;
  }
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  const m = raw.match(/^(?:tt)?(\d{5,10})$/i);
  if (!m) return "";
  return `tt${m[1]}`;
}

export function movieKindLabel(kind: MovieKindId | string): string {
  return MOVIE_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? "";
}

export function movieStatusLabel(status: MovieStatusId | string): string {
  return MOVIE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? "";
}

/** Sanitize a film title into a vault note file stem (no `.md`). */
export function sanitizeFilmNoteName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled film";
}

export const FILM_NOTE_BODY_TEMPLATE = `## Why I liked it

## Notes
`;

/** Leading poster markdown image, or null if body has none at the start. */
const LEADING_POSTER_RE =
  /^(?:\s*\n)*!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*(?:\n|$)/;

export function leadingPosterUrl(body: string): string | null {
  const m = body.match(LEADING_POSTER_RE);
  return m?.[1] ?? null;
}

/** Insert or replace the leading image block; keep the rest of the body. */
export function withLeadingPoster(body: string, assetUrl: string, width = 240): string {
  const image = `![|${width}](${assetUrl})`;
  const rest = body.replace(LEADING_POSTER_RE, "").replace(/^\n+/, "");
  if (!rest.trim()) return `${image}\n\n`;
  return `${image}\n\n${rest}`;
}

export function buildFilmNoteMarkdown(opts: {
  kind?: MovieKindId | "";
  genres?: string[];
  year?: number | null;
  rating?: number | null;
  director?: string;
  status?: MovieStatusId | "";
  originalTitle?: string;
  imdbId?: string;
  kinopoiskId?: number | null;
  posterAssetUrl?: string | null;
  body?: string;
}): string {
  const lines: string[] = ["---"];
  if (opts.kind && isMovieKindId(opts.kind)) {
    lines.push(`kind: ${opts.kind}`);
  }
  const genres = (opts.genres ?? []).map((g) => g.trim()).filter(Boolean);
  if (genres.length > 0) {
    lines.push("genres:");
    for (const g of genres) lines.push(`  - ${g}`);
  }
  if (opts.year != null && Number.isFinite(opts.year) && opts.year > 0) {
    lines.push(`year: ${Math.round(opts.year)}`);
  }
  if (opts.rating != null && Number.isFinite(opts.rating) && opts.rating > 0) {
    lines.push(`rating: ${Math.round(opts.rating)}`);
  }
  const director = (opts.director ?? "").trim();
  if (director) lines.push(`director: ${director}`);
  if (opts.status && isMovieStatusId(opts.status)) {
    lines.push(`status: ${opts.status}`);
  }
  const originalTitle = (opts.originalTitle ?? "").trim();
  if (originalTitle) lines.push(`original_title: ${originalTitle}`);
  const imdbId = normalizeImdbId(opts.imdbId ?? "");
  if (imdbId) lines.push(`imdb_id: ${imdbId}`);
  if (
    opts.kinopoiskId != null &&
    Number.isFinite(opts.kinopoiskId) &&
    opts.kinopoiskId > 0
  ) {
    lines.push(`kinopoisk_id: ${Math.round(opts.kinopoiskId)}`);
  }
  lines.push("---", "");
  let body = opts.body ?? FILM_NOTE_BODY_TEMPLATE;
  if (opts.posterAssetUrl) {
    body = withLeadingPoster(body, opts.posterAssetUrl);
  }
  return `${lines.join("\n")}${body.startsWith("\n") ? body.slice(1) : body}`;
}

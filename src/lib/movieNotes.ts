/** Media library project card helpers — kinds, ratings, note templates, poster body. */

export type MovieKindId = "film" | "series" | "animation";
/** Personal quality rating (not a 1–10 score). */
export type MovieRatingId = "legend" | "quality" | "watchable" | "fine";

export const MOVIE_KIND_OPTIONS: { value: MovieKindId; label: string }[] = [
  { value: "film", label: "Film" },
  { value: "series", label: "Series" },
  { value: "animation", label: "Animation" },
];

/** Higher rank = better (for sort). */
export const MOVIE_RATING_OPTIONS: {
  value: MovieRatingId;
  label: string;
  rank: number;
}[] = [
  { value: "legend", label: "Легенда", rank: 4 },
  { value: "quality", label: "Качественный", rank: 3 },
  { value: "watchable", label: "Можно посмотреть", rank: 2 },
  { value: "fine", label: "Нормально", rank: 1 },
];

export function isMovieKindId(value: unknown): value is MovieKindId {
  return value === "film" || value === "series" || value === "animation";
}

export function isMovieRatingId(value: unknown): value is MovieRatingId {
  return (
    value === "legend" ||
    value === "quality" ||
    value === "watchable" ||
    value === "fine"
  );
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

export function movieRatingLabel(rating: MovieRatingId | string): string {
  return MOVIE_RATING_OPTIONS.find((o) => o.value === rating)?.label ?? "";
}

export function movieRatingRank(rating: MovieRatingId | string | ""): number {
  return MOVIE_RATING_OPTIONS.find((o) => o.value === rating)?.rank ?? 0;
}

/**
 * Display name for a genre shelf folder (`ужасы` → `Ужасы`).
 * Strips path separators so the name is a single path segment.
 */
export function genreShelfFolderName(genre: string): string {
  const cleaned = genre
    .trim()
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toLocaleUpperCase() + cleaned.slice(1);
}

/**
 * Target folder for a new film card under a Media library project.
 *
 * - Prefer an existing direct child whose name matches any genre (case-insensitive),
 *   so e.g. genres `[боевик, ужасы]` land in existing `Ужасы`.
 * - Otherwise `{projectRoot}/{FirstGenre}` from the first genre.
 * - No genres → project root.
 */
export function resolveFilmShelfFolder(opts: {
  projectRoot: string;
  genres: string[];
  existingChildFolders: string[];
}): string {
  const root = opts.projectRoot.replace(/^\/+|\/+$/g, "");
  const genres = opts.genres.map((g) => g.trim()).filter(Boolean);
  if (!root) return "";
  if (genres.length === 0) return root;

  const byLower = new Map<string, string>();
  for (const name of opts.existingChildFolders) {
    const n = name.trim();
    if (!n || n.startsWith(".")) continue;
    byLower.set(n.toLowerCase(), n);
  }

  for (const g of genres) {
    const hit = byLower.get(g.toLowerCase());
    if (hit) return `${root}/${hit}`;
  }

  const shelf = genreShelfFolderName(genres[0]!);
  if (!shelf) return root;
  return `${root}/${shelf}`;
}

const WATCHED_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate and normalize a single watch day `YYYY-MM-DD` (local calendar). */
export function normalizeWatchedDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // YAML may parse unquoted 2024-03-12 as a number in edge cases — reject.
    return null;
  }
  if (typeof value !== "string") return null;
  const m = WATCHED_DAY_RE.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Parse `watched:` from YAML. Keeps duplicates (rewatches count).
 * Invalid entries dropped; result sorted ascending for stable diffs.
 */
export function normalizeWatchedDates(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? [value]
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const iso = normalizeWatchedDate(item);
    if (iso) out.push(iso);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** Local today as `YYYY-MM-DD`. */
export function localWatchedToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Append a watch day (default today). Duplicates allowed. */
export function appendWatchedDate(
  dates: readonly string[],
  date: string = localWatchedToday(),
): string[] {
  const iso = normalizeWatchedDate(date);
  if (!iso) return normalizeWatchedDates(dates);
  return normalizeWatchedDates([...dates, iso]);
}

export function lastWatchedDate(dates: readonly string[]): string | null {
  const normalized = normalizeWatchedDates(dates);
  return normalized.length > 0 ? normalized[normalized.length - 1]! : null;
}

/** Short English stats for card chrome, or null if never watched. Eye icon replaces the word “Watched”. */
export function formatMovieWatchedSummary(
  dates: readonly string[],
): string | null {
  const normalized = normalizeWatchedDates(dates);
  if (normalized.length === 0) return null;
  const last = normalized[normalized.length - 1]!;
  const count = normalized.length;
  const times = count === 1 ? "1×" : `${count}×`;
  return `${times} · last ${formatWatchedDayLabel(last)}`;
}

function formatWatchedDayLabel(iso: string): string {
  const parsed = normalizeWatchedDate(iso);
  if (!parsed) return iso;
  const [y, m, d] = parsed.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Sanitize a film title into a vault note file stem fragment (no `.md`, no year). */
export function sanitizeFilmNoteName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "Untitled film";
}

/**
 * Auto file stem for app/agent-created film notes: `{year}-{title}`.
 * Prefers localized `title`, falls back to `originalTitle`. Year omitted if unknown.
 */
export function filmNoteFileStem(opts: {
  title?: string;
  originalTitle?: string;
  year?: number | null;
}): string {
  const native = (opts.title ?? "").trim();
  const original = (opts.originalTitle ?? "").trim();
  const name = sanitizeFilmNoteName(native || original);
  const year =
    opts.year != null && Number.isFinite(opts.year) && opts.year > 0
      ? Math.round(opts.year)
      : null;
  if (year == null) return name;
  const titlePart = name.slice(0, 100);
  return `${year}-${titlePart}`;
}

export const FILM_NOTE_BODY_TEMPLATE = "";

/** Leading poster markdown image, or null if body has none at the start. */
const LEADING_POSTER_RE =
  /^(?:\s*\n)*!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*(?:\n|$)/;

const FILM_SECTION_HEADING_RE =
  /^##[ \t]+(?:Why I liked it|Notes)[ \t]*\r?\n?/gim;

/**
 * Collapse legacy `## Why I liked it` / `## Notes` headings into free body text.
 * Keeps poster and content under those headings.
 */
export function collapseFilmNoteBodySections(body: string): string {
  const posterMatch = body.match(LEADING_POSTER_RE);
  const poster = posterMatch?.[0]?.trimEnd() ?? "";
  let rest = posterMatch ? body.slice(posterMatch[0].length) : body;
  rest = rest.replace(FILM_SECTION_HEADING_RE, "");
  rest = rest.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "");
  if (poster && rest) return `${poster}\n\n${rest}\n`;
  if (poster) return `${poster}\n\n`;
  if (rest) return `${rest}\n`;
  return "";
}

/** First non-empty lines of film body after the poster (for catalog tiles). */
export function filmNoteCommentPreview(body: string, maxLines = 2): string {
  const collapsed = collapseFilmNoteBodySections(body);
  const withoutPoster = collapsed.replace(LEADING_POSTER_RE, "").trim();
  if (!withoutPoster) return "";
  const lines = withoutPoster
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const take = lines.slice(0, Math.max(1, maxLines));
  const text = take.join("\n");
  return lines.length > maxLines ? `${text}…` : text;
}

export function leadingPosterUrl(body: string): string | null {
  const m = body.match(LEADING_POSTER_RE);
  return m?.[1] ?? null;
}

/**
 * Prefer YAML `poster:`, else leading body image.
 * Returns a note-relative path (e.g. `.assets/poster.jpg`).
 */
export function resolveFilmPosterRel(
  posterAttr: string | undefined | null,
  body: string,
): string | null {
  const fromAttr = (posterAttr ?? "").trim().replace(/^\.\//, "");
  if (fromAttr) return fromAttr;
  const fromBody = leadingPosterUrl(body);
  return fromBody ? fromBody.replace(/^\.\//, "") : null;
}

/** Body without the leading poster image (notes-only). */
export function bodyWithoutLeadingPoster(body: string): string {
  return body.replace(LEADING_POSTER_RE, "").replace(/^\n+/, "");
}

/** Insert or replace the leading image block; keep the rest of the body. */
export function withLeadingPoster(body: string, assetUrl: string, width = 240): string {
  const image = `![|${width}](${assetUrl})`;
  const rest = body.replace(LEADING_POSTER_RE, "").replace(/^\n+/, "");
  if (!rest.trim()) return `${image}\n\n`;
  return `${image}\n\n${rest}`;
}

export function buildFilmNoteMarkdown(opts: {
  title?: string;
  kind?: MovieKindId | "";
  genres?: string[];
  countries?: string[];
  year?: number | null;
  rating?: MovieRatingId | "";
  director?: string;
  originalTitle?: string;
  imdbId?: string;
  kinopoiskId?: number | null;
  posterAssetUrl?: string | null;
  body?: string;
}): string {
  const lines: string[] = ["---"];
  const title = (opts.title ?? "").trim();
  if (title) lines.push(`title: ${title}`);
  const originalTitle = (opts.originalTitle ?? "").trim();
  if (originalTitle) lines.push(`original_title: ${originalTitle}`);
  if (opts.kind && isMovieKindId(opts.kind)) {
    lines.push(`kind: ${opts.kind}`);
  }
  const genres = (opts.genres ?? []).map((g) => g.trim()).filter(Boolean);
  if (genres.length > 0) {
    lines.push("genres:");
    for (const g of genres) lines.push(`  - ${g}`);
  }
  const countries = (opts.countries ?? []).map((c) => c.trim()).filter(Boolean);
  if (countries.length > 0) {
    lines.push("countries:");
    for (const c of countries) lines.push(`  - ${c}`);
  }
  if (opts.year != null && Number.isFinite(opts.year) && opts.year > 0) {
    lines.push(`year: ${Math.round(opts.year)}`);
  }
  if (opts.rating && isMovieRatingId(opts.rating)) {
    lines.push(`rating: ${opts.rating}`);
  }
  const director = (opts.director ?? "").trim();
  if (director) lines.push(`director: ${director}`);
  const imdbId = normalizeImdbId(opts.imdbId ?? "");
  if (imdbId) lines.push(`imdb_id: ${imdbId}`);
  if (
    opts.kinopoiskId != null &&
    Number.isFinite(opts.kinopoiskId) &&
    opts.kinopoiskId > 0
  ) {
    lines.push(`kinopoisk_id: ${Math.round(opts.kinopoiskId)}`);
  }
  const poster = (opts.posterAssetUrl ?? "").trim().replace(/^\.\//, "");
  if (poster) lines.push(`poster: ${poster}`);
  lines.push("---", "");
  let body = opts.body ?? FILM_NOTE_BODY_TEMPLATE;
  if (opts.posterAssetUrl) {
    body = withLeadingPoster(body, opts.posterAssetUrl);
  }
  return `${lines.join("\n")}${body.startsWith("\n") ? body.slice(1) : body}`;
}

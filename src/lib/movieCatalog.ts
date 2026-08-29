/** Unified movie catalog lookup: Kinopoisk for Russian, OMDb otherwise. */

import type { MovieKindId } from "./movieNotes";
import {
  getKinopoiskDetails,
  searchKinopoisk,
} from "./kinopoisk";
import {
  getOmdbDetails,
  searchOmdb,
  type OmdbDetails,
} from "./omdb";
import type { NativeLanguageId } from "../settings/types";

const CYRILLIC_RE = /[\u0400-\u04FF]/;

export function hasCyrillic(text: string): boolean {
  return CYRILLIC_RE.test(text);
}

export type CatalogSearchHit = {
  provider: "kinopoisk" | "omdb";
  /** Provider id for details fetch (kinopoisk id as string, or imdb id). */
  id: string;
  title: string;
  originalTitle: string;
  year: number | null;
  type: string;
  posterUrl: string | null;
  imdbId: string;
};

export type CatalogDetails = {
  provider: "kinopoisk" | "omdb";
  title: string;
  originalTitle: string;
  year: number | null;
  director: string;
  genres: string[];
  posterUrl: string | null;
  imdbId: string;
  kinopoiskId: number | null;
};

export function shouldUseKinopoisk(
  query: string,
  nativeLanguage: NativeLanguageId | string,
  kinopoiskKey: string,
): boolean {
  if (!kinopoiskKey.trim()) return false;
  if (nativeLanguage === "ru" || nativeLanguage === "uk") return true;
  return hasCyrillic(query);
}

export async function searchMovieCatalog(opts: {
  query: string;
  kind: MovieKindId;
  nativeLanguage: NativeLanguageId | string;
  kinopoiskApiKey: string;
  omdbApiKey: string;
}): Promise<{ hits: CatalogSearchHit[]; provider: "kinopoisk" | "omdb" | null }> {
  const q = opts.query.trim();
  if (!q) return { hits: [], provider: null };

  const useKp = shouldUseKinopoisk(
    q,
    opts.nativeLanguage,
    opts.kinopoiskApiKey,
  );

  if (useKp) {
    const raw = await searchKinopoisk(opts.kinopoiskApiKey, q, opts.kind);
    return {
      provider: "kinopoisk",
      hits: raw.map((h) => ({
        provider: "kinopoisk" as const,
        id: String(h.kinopoiskId),
        title: h.title,
        originalTitle: h.originalTitle,
        year: h.year,
        type: h.type,
        posterUrl: h.posterUrl,
        imdbId: h.imdbId,
      })),
    };
  }

  if (!opts.omdbApiKey.trim()) {
    if (hasCyrillic(q)) {
      throw new Error(
        "Russian titles need a Kinopoisk API key (Settings → Media library).",
      );
    }
    throw new Error("OMDb API key is not set (Settings → Media library).");
  }

  const raw = await searchOmdb(opts.omdbApiKey, q, opts.kind);
  return {
    provider: "omdb",
    hits: raw.map((h) => ({
      provider: "omdb" as const,
      id: h.imdbId,
      title: h.title,
      originalTitle: "",
      year: h.year,
      type: h.type,
      posterUrl: h.posterUrl,
      imdbId: h.imdbId,
    })),
  };
}

export async function getMovieCatalogDetails(opts: {
  hit: CatalogSearchHit;
  kinopoiskApiKey: string;
  omdbApiKey: string;
}): Promise<CatalogDetails> {
  if (opts.hit.provider === "kinopoisk") {
    const id = Number(opts.hit.id);
    const d = await getKinopoiskDetails(opts.kinopoiskApiKey, id);
    return {
      provider: "kinopoisk",
      title: d.title,
      originalTitle: d.originalTitle,
      year: d.year,
      director: d.director,
      genres: d.genres,
      posterUrl: d.posterUrl,
      imdbId: d.imdbId || opts.hit.imdbId,
      kinopoiskId: d.kinopoiskId,
    };
  }

  const d: OmdbDetails = await getOmdbDetails(opts.omdbApiKey, opts.hit.id);
  return {
    provider: "omdb",
    title: d.title,
    originalTitle: "",
    year: d.year,
    director: d.director,
    genres: d.genres,
    posterUrl: d.posterUrl,
    imdbId: d.imdbId,
    kinopoiskId: null,
  };
}

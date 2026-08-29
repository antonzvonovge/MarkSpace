/** Kinopoisk Api Unofficial — Russian-native titles + original name. */

import { invoke } from "@tauri-apps/api/core";
import type { MovieKindId } from "./movieNotes";

const KP_API = "https://kinopoiskapiunofficial.tech";

export type KinopoiskSearchHit = {
  kinopoiskId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  type: string;
  posterUrl: string | null;
  imdbId: string;
};

export type KinopoiskDetails = {
  kinopoiskId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  director: string;
  genres: string[];
  posterUrl: string | null;
  imdbId: string;
  type: string;
};

function yearFromRaw(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1800) {
    return Math.round(raw);
  }
  if (typeof raw === "string") {
    const m = raw.match(/(\d{4})/);
    if (!m) return null;
    const y = Number(m[1]);
    return Number.isFinite(y) && y > 1800 ? y : null;
  }
  return null;
}

function posterOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (!p || /^n\/?a$/i.test(p)) return null;
  return p;
}

function pickTitle(ru: unknown, en: unknown, original: unknown): {
  title: string;
  originalTitle: string;
} {
  const nameRu = typeof ru === "string" ? ru.trim() : "";
  const nameEn = typeof en === "string" ? en.trim() : "";
  const nameOriginal = typeof original === "string" ? original.trim() : "";
  const title = nameRu || nameEn || nameOriginal;
  const originalTitle =
    nameOriginal ||
    (nameEn && nameEn !== nameRu ? nameEn : "") ||
    "";
  return { title, originalTitle };
}

function mapKpType(raw: unknown): string {
  const t = String(raw ?? "").toUpperCase();
  if (t.includes("TV") || t.includes("SERIES") || t === "MINI_SERIES") {
    return "series";
  }
  if (t.includes("CARTOON") || t.includes("ANIMATED")) return "animation";
  if (t === "FILM" || t === "VIDEO") return "movie";
  return t ? t.toLowerCase() : "movie";
}

function kindMatches(kind: MovieKindId, mappedType: string): boolean {
  if (kind === "film") return mappedType === "movie" || mappedType === "film";
  if (kind === "series") return mappedType === "series";
  if (kind === "animation") return true; // KP type rarely marks animation; keep all
  return true;
}

async function kpGetJson<T>(apiKey: string, path: string): Promise<T> {
  const key = apiKey.trim();
  if (!key) {
    throw new Error("Kinopoisk API key is not set (Settings → Media library).");
  }
  const url = path.startsWith("http") ? path : `${KP_API}${path}`;
  const res = await invoke<{ status: number; body: string }>("http_fetch", {
    req: {
      url,
      method: "GET",
      headers: {
        "X-API-KEY": key,
        Accept: "application/json",
      },
      body: null,
      timeoutSecs: 20,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    let detail = "";
    try {
      const errBody = JSON.parse(res.body) as { message?: string };
      if (errBody.message?.trim()) detail = errBody.message.trim();
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        detail ||
          "Kinopoisk HTTP 401/403 — check the API key at kinopoiskapiunofficial.tech",
      );
    }
    throw new Error(
      detail ? `Kinopoisk HTTP ${res.status}: ${detail}` : `Kinopoisk HTTP ${res.status}`,
    );
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error("Kinopoisk returned invalid JSON");
  }
}

type KpSearchJson = {
  films?: Array<{
    filmId?: number;
    kinopoiskId?: number;
    nameRu?: string | null;
    nameEn?: string | null;
    nameOriginal?: string | null;
    type?: string;
    year?: string | number;
    posterUrl?: string | null;
    posterUrlPreview?: string | null;
    imdbId?: string | null;
  }>;
};

type KpFilmJson = {
  kinopoiskId?: number;
  imdbId?: string | null;
  nameRu?: string | null;
  nameEn?: string | null;
  nameOriginal?: string | null;
  type?: string;
  year?: number | string;
  posterUrl?: string | null;
  genres?: Array<{ genre?: string }>;
};

type KpStaffJson = Array<{
  nameRu?: string | null;
  nameEn?: string | null;
  professionKey?: string | null;
}>;

export async function searchKinopoisk(
  apiKey: string,
  query: string,
  kind: MovieKindId,
): Promise<KinopoiskSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const path = `/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(q)}&page=1`;
  const data = await kpGetJson<KpSearchJson>(apiKey, path);
  const hits: KinopoiskSearchHit[] = [];
  for (const f of data.films ?? []) {
    const id = f.filmId ?? f.kinopoiskId;
    if (id == null || !Number.isFinite(id)) continue;
    const mapped = mapKpType(f.type);
    if (!kindMatches(kind, mapped)) continue;
    const { title, originalTitle } = pickTitle(f.nameRu, f.nameEn, f.nameOriginal);
    if (!title) continue;
    const imdbRaw = typeof f.imdbId === "string" ? f.imdbId.trim() : "";
    hits.push({
      kinopoiskId: id,
      title,
      originalTitle,
      year: yearFromRaw(f.year),
      type: mapped,
      posterUrl: posterOrNull(f.posterUrl) ?? posterOrNull(f.posterUrlPreview),
      imdbId: imdbRaw,
    });
    if (hits.length >= 20) break;
  }
  return hits;
}

export async function getKinopoiskDetails(
  apiKey: string,
  kinopoiskId: number,
): Promise<KinopoiskDetails> {
  const film = await kpGetJson<KpFilmJson>(
    apiKey,
    `/api/v2.2/films/${kinopoiskId}`,
  );
  const { title, originalTitle } = pickTitle(
    film.nameRu,
    film.nameEn,
    film.nameOriginal,
  );
  const genres: string[] = [];
  const seen = new Set<string>();
  for (const g of film.genres ?? []) {
    const name = (g.genre ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    genres.push(name);
  }

  let director = "";
  try {
    const staff = await kpGetJson<KpStaffJson>(
      apiKey,
      `/api/v1/staff?filmId=${kinopoiskId}`,
    );
    const directors = staff.filter(
      (p) => (p.professionKey ?? "").toUpperCase() === "DIRECTOR",
    );
    director =
      directors
        .map((d) => (d.nameRu || d.nameEn || "").trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(", ") || "";
  } catch {
    /* staff optional */
  }

  const imdbRaw = typeof film.imdbId === "string" ? film.imdbId.trim() : "";
  return {
    kinopoiskId: film.kinopoiskId ?? kinopoiskId,
    title: title || `Film ${kinopoiskId}`,
    originalTitle,
    year: yearFromRaw(film.year),
    director,
    genres,
    posterUrl: posterOrNull(film.posterUrl),
    imdbId: imdbRaw,
    type: mapKpType(film.type),
  };
}

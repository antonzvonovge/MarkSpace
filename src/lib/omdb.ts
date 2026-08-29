/** OMDb (Open Movie Database) client for Media library project cards. */

import { invoke } from "@tauri-apps/api/core";
import { httpFetchBytes, writeAsset } from "./vaultApi";
import type { MovieKindId } from "./movieNotes";

const OMDB_API = "https://www.omdbapi.com/";

export type OmdbSearchHit = {
  imdbId: string;
  title: string;
  year: number | null;
  type: "movie" | "series" | "episode" | string;
  posterUrl: string | null;
};

export type OmdbDetails = {
  imdbId: string;
  title: string;
  year: number | null;
  director: string;
  genres: string[];
  posterUrl: string | null;
  type: string;
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function yearFromRaw(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

function posterOrNull(raw: string | null | undefined): string | null {
  const p = (raw ?? "").trim();
  if (!p || /^n\/?a$/i.test(p)) return null;
  return p;
}

function genresFromCsv(raw: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim();
    if (!name || /^n\/?a$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

async function omdbGetJson<T extends { Response?: string; Error?: string }>(
  apiKey: string,
  query: Record<string, string>,
  opts?: { allowFalse?: boolean },
): Promise<T> {
  // Users sometimes paste "apikey=…" or a full URL fragment.
  let key = apiKey.trim().replace(/^apikey\s*=\s*/i, "");
  if (key.includes("omdbapi.com")) {
    try {
      const fromUrl = new URL(
        key.includes("://") ? key : `https://${key.replace(/^\/*/, "")}`,
      ).searchParams.get("apikey");
      if (fromUrl) key = fromUrl.trim();
    } catch {
      /* keep trimmed key */
    }
  }
  key = key.replace(/\s+/g, "");
  if (!key) throw new Error("OMDb API key is not set (Settings → Media library).");

  // OMDb has a long-standing quirk: when `apikey` is the last query param,
  // some clients get Invalid API key / 401. Keep it first and append a noop.
  const params = new URLSearchParams();
  params.set("apikey", key);
  for (const [k, v] of Object.entries(query)) {
    if (k === "apikey") continue;
    params.set(k, v);
  }
  params.set("_", "1");
  const url = `${OMDB_API}?${params.toString()}`;
  const res = await invoke<{ status: number; body: string }>("http_fetch", {
    req: {
      url,
      method: "GET",
      // More browser-like UA — Cloudflare occasionally 401s the app UA.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
      body: null,
      timeoutSecs: 20,
    },
  });
  if (res.status < 200 || res.status >= 300) {
    let detail = "";
    try {
      const errBody = JSON.parse(res.body) as { Error?: string };
      if (errBody.Error?.trim()) detail = errBody.Error.trim();
    } catch {
      /* ignore */
    }
    if (res.status === 401) {
      throw new Error(
        detail
          ? `OMDb: ${detail}`
          : "OMDb HTTP 401 — check the key and open the activation link in the OMDb email (Settings → Media library).",
      );
    }
    throw new Error(
      detail ? `OMDb HTTP ${res.status}: ${detail}` : `OMDb HTTP ${res.status}`,
    );
  }
  let data: T;
  try {
    data = JSON.parse(res.body) as T;
  } catch {
    throw new Error("OMDb returned invalid JSON");
  }
  if (data.Response === "False" && !opts?.allowFalse) {
    const err = data.Error?.trim() || "OMDb lookup failed";
    if (/invalid api key/i.test(err)) {
      throw new Error(
        "OMDb: Invalid API key — activate it via the link in the email from OMDb, then paste only the key (not the URL).",
      );
    }
    throw new Error(err);
  }
  return data;
}

type OmdbSearchJson = {
  Response?: string;
  Error?: string;
  Search?: Array<{
    Title?: string;
    Year?: string;
    imdbID?: string;
    Type?: string;
    Poster?: string;
  }>;
};

type OmdbDetailsJson = {
  Response?: string;
  Error?: string;
  Title?: string;
  Year?: string;
  Director?: string;
  Genre?: string;
  Poster?: string;
  imdbID?: string;
  Type?: string;
};

function omdbTypeForKind(kind: MovieKindId): string | null {
  if (kind === "film") return "movie";
  if (kind === "series") return "series";
  return null; // animation: search all types
}

/** Search OMDb by title; kind maps to `type` (animation = no type filter). */
export async function searchOmdb(
  apiKey: string,
  query: string,
  kind: MovieKindId,
): Promise<OmdbSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const params: Record<string, string> = { s: q };
  const type = omdbTypeForKind(kind);
  if (type) params.type = type;
  const data = await omdbGetJson<OmdbSearchJson>(apiKey, params, {
    allowFalse: true,
  });
  if (data.Response === "False") return [];
  const hits = (data.Search ?? [])
    .filter((r) => (r.imdbID ?? "").trim())
    .map((r) => ({
      imdbId: (r.imdbID ?? "").trim(),
      title: (r.Title ?? "").trim() || (r.imdbID ?? "").trim(),
      year: yearFromRaw(r.Year),
      type: (r.Type ?? "").trim() || "movie",
      posterUrl: posterOrNull(r.Poster),
    }));
  if (kind === "animation") {
    const score = (h: OmdbSearchHit) =>
      /animat|cartoon|anime|pixar|disney/i.test(h.title) ? 0 : 1;
    hits.sort((a, b) => score(a) - score(b));
  }
  return hits.slice(0, 20);
}

export async function getOmdbDetails(
  apiKey: string,
  imdbId: string,
): Promise<OmdbDetails> {
  const id = imdbId.trim();
  if (!id) throw new Error("Missing IMDb id");
  const data = await omdbGetJson<OmdbDetailsJson>(apiKey, { i: id, plot: "short" });
  const directorRaw = (data.Director ?? "").trim();
  const director = !directorRaw || /^n\/?a$/i.test(directorRaw) ? "" : directorRaw;
  return {
    imdbId: (data.imdbID ?? id).trim(),
    title: (data.Title ?? "").trim() || id,
    year: yearFromRaw(data.Year),
    director,
    genres: genresFromCsv(data.Genre),
    posterUrl: posterOrNull(data.Poster),
    type: (data.Type ?? "").trim(),
  };
}

/** Download a remote image into the note's `.assets/` as `poster.<ext>`. */
export async function downloadPosterToAssets(
  notePath: string,
  imageUrl: string,
): Promise<string> {
  const res = await httpFetchBytes(imageUrl, { timeoutSecs: 20 });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Poster download HTTP ${res.status}`);
  }
  if (res.byteLength < 200) {
    throw new Error("Poster download too small");
  }
  const bytes = base64ToBytes(res.dataBase64);
  const ct = (res.contentType ?? "").toLowerCase();
  let ext = "jpg";
  if (ct.includes("png") || imageUrl.toLowerCase().includes(".png")) ext = "png";
  else if (ct.includes("webp") || imageUrl.toLowerCase().includes(".webp")) {
    ext = "webp";
  } else if (ct.includes("gif")) ext = "gif";
  return writeAsset(notePath, `poster.${ext}`, bytes);
}

/** Scan Media library folders for film card notes (catalog tiles). */

import {
  filmNoteCommentPreview,
  resolveFilmPosterRel,
  type MovieKindId,
  type MovieRatingId,
} from "./movieNotes";
import { getMovieAttrs, noteBody } from "./noteFrontmatter";
import {
  isFolderNotePath,
  joinPath,
  parentPath,
  readNote,
  type TreeNode,
} from "./vaultApi";

export type MediaCatalogEntry = {
  path: string;
  /** Display title (YAML title, else file stem). */
  title: string;
  originalTitle: string;
  kind: MovieKindId | "";
  genres: string[];
  countries: string[];
  year: number | null;
  rating: MovieRatingId | "";
  director: string;
  /** Watch days `YYYY-MM-DD` (duplicates count as rewatches). */
  watched: string[];
  /** Vault-relative poster path, or null. */
  posterVaultPath: string | null;
  commentPreview: string;
};

function displayTitleFromPath(path: string, yamlTitle: string): string {
  if (yamlTitle.trim()) return yamlTitle.trim();
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.md$/i, "");
  const m = stem.match(/^(\d{4})-(.+)$/);
  return (m?.[2] ?? stem).trim() || stem;
}

/** Collect vault-relative `.md` paths under `folder` (recursive), excluding `.folder.md`. */
export function collectFilmNotePathsUnder(
  tree: TreeNode | null | undefined,
  folder: string,
): string[] {
  const cleaned = folder.replace(/^\/+|\/+$/g, "");
  const root = findNode(tree, cleaned);
  if (!root?.isDir) return [];
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.isDir) {
        walk(child);
        continue;
      }
      if (!child.path.toLowerCase().endsWith(".md")) continue;
      if (isFolderNotePath(child.path)) continue;
      out.push(child.path);
    }
  };
  walk(root);
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

function findNode(
  tree: TreeNode | null | undefined,
  path: string,
): TreeNode | null {
  if (!tree) return null;
  if (!path) return tree;
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, path);
    if (hit) return hit;
  }
  return null;
}

export function mediaCatalogEntryFromMarkdown(
  path: string,
  markdown: string,
): MediaCatalogEntry {
  const attrs = getMovieAttrs(markdown);
  const body = noteBody(markdown);
  const posterRel = resolveFilmPosterRel(attrs.poster, body);
  const noteParent = parentPath(path);
  const posterVaultPath = posterRel
    ? joinPath(noteParent, posterRel.replace(/^\.\//, ""))
    : null;
  return {
    path,
    title: displayTitleFromPath(path, attrs.title),
    originalTitle: attrs.originalTitle,
    kind: attrs.kind,
    genres: attrs.genres,
    countries: attrs.countries,
    year: attrs.year,
    rating: attrs.rating,
    director: attrs.director,
    watched: attrs.watched,
    posterVaultPath,
    commentPreview: filmNoteCommentPreview(body, 2),
  };
}

const READ_CONCURRENCY = 8;

/** Load catalog entries for all film notes under `folder` (recursive). */
export async function loadMediaCatalogEntries(
  tree: TreeNode | null | undefined,
  folder: string,
): Promise<MediaCatalogEntry[]> {
  const paths = collectFilmNotePathsUnder(tree, folder);
  const entries: MediaCatalogEntry[] = [];
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const chunk = paths.slice(i, i + READ_CONCURRENCY);
    const loaded = await Promise.all(
      chunk.map(async (path) => {
        try {
          const md = await readNote(path);
          return mediaCatalogEntryFromMarkdown(path, md);
        } catch {
          return null;
        }
      }),
    );
    for (const e of loaded) {
      if (e) entries.push(e);
    }
  }
  return entries;
}

export type MediaCatalogFilters = {
  query: string;
  kind: MovieKindId | "";
  genre: string;
};

export function emptyMediaCatalogFilters(): MediaCatalogFilters {
  return {
    query: "",
    kind: "",
    genre: "",
  };
}

export function filterMediaCatalogEntries(
  entries: readonly MediaCatalogEntry[],
  filters: MediaCatalogFilters,
): MediaCatalogEntry[] {
  const q = filters.query.trim().toLowerCase();
  const genre = filters.genre.trim();
  return entries.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (genre && !e.genres.includes(genre)) return false;
    if (!q) return true;
    const hay = [
      e.title,
      e.originalTitle,
      e.director,
      e.commentPreview,
      ...e.genres,
      ...e.countries,
      e.year != null ? String(e.year) : "",
    ]
      .join("\n")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function collectCatalogGenres(
  entries: readonly MediaCatalogEntry[],
): string[] {
  const set = new Set<string>();
  for (const e of entries) {
    for (const g of e.genres) {
      const t = g.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

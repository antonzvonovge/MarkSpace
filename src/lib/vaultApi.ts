import { invoke } from "@tauri-apps/api/core";
import { normalizeMarkdown } from "./normalizeMarkdown";

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
};

export type VaultChange = {
  kind: string;
  path: string;
};

export async function openVault(path: string): Promise<TreeNode> {
  return invoke("open_vault", { path });
}

export async function listTree(): Promise<TreeNode> {
  return invoke("list_tree");
}

export async function readNote(path: string): Promise<string> {
  const raw = await invoke<string>("read_note", { path });
  // Don't run markdown fence healing on draw.io XML.
  if (path.toLowerCase().endsWith(".drawio")) return raw;
  return normalizeMarkdown(raw);
}

export async function writeNote(path: string, content: string): Promise<void> {
  const payload = path.toLowerCase().endsWith(".drawio")
    ? content
    : normalizeMarkdown(content);
  return invoke("write_note", { path, content: payload });
}

export async function createNote(path: string): Promise<string> {
  return invoke("create_note", { path });
}

export async function createDrawio(path: string): Promise<string> {
  return invoke("create_drawio", { path });
}

/** Embed path for a .drawio: vault-relative if already inside, else copy next to the note. */
export async function importDrawio(
  notePath: string,
  sourceAbsPath: string,
): Promise<string> {
  return invoke("import_drawio", { notePath, source: sourceAbsPath });
}

/** Copy external absolute paths (files/folders) into a vault folder. */
export async function importPaths(
  parent: string,
  sources: string[],
): Promise<string[]> {
  return invoke("import_paths", { parent, sources });
}

/** Write a .md / .drawio from bytes into a vault folder. */
export async function importDocumentBytes(
  parent: string,
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  return invoke("import_document_bytes", {
    parent,
    fileName,
    dataBase64: uint8ToBase64(data),
  });
}

export async function createFolder(path: string): Promise<string> {
  return invoke("create_folder", { path });
}

export async function renamePath(from: string, to: string): Promise<string> {
  return invoke("rename_path", { from, to });
}

export async function moveEntry(
  from: string,
  toParent: string,
  toIndex: number,
): Promise<string> {
  return invoke("move_entry", { from, toParent, toIndex });
}

export async function deletePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

export async function resolveWikiTarget(target: string): Promise<string | null> {
  return invoke("resolve_wiki_target", { target });
}

export async function getVaultPath(): Promise<string | null> {
  return invoke("get_vault_path");
}

export async function absolutePath(path: string): Promise<string> {
  return invoke("absolute_path", { path });
}

export async function writeAsset(
  notePath: string,
  fileName: string,
  data: Uint8Array,
): Promise<string> {
  return invoke("write_asset", {
    notePath,
    fileName,
    dataBase64: uint8ToBase64(data),
  });
}

export type SearchHit = {
  path: string;
  line: number;
  snippet: string;
};

export async function searchNotes(query: string): Promise<SearchHit[]> {
  return invoke("search_notes", { query });
}

/** Unique note tags from the in-memory vault tag index. */
export async function listVaultTags(): Promise<string[]> {
  return invoke("list_vault_tags");
}

/** Re-read one note's frontmatter into the tag index; returns full catalog. */
export async function reindexNoteTags(path: string): Promise<string[]> {
  return invoke("reindex_note_tags", { path });
}

/** Vault-relative paths stored as one file each under `.markspace/favorites/`. */
export async function listFavorites(): Promise<string[]> {
  return invoke("list_favorites");
}

export async function addFavorite(path: string): Promise<string[]> {
  return invoke("add_favorite", { path });
}

export async function removeFavorite(path: string): Promise<string[]> {
  return invoke("remove_favorite", { path });
}

export type ProjectProperties = {
  path: string;
  /** Free-form description ("What is this project about"). */
  about: string;
};

export async function getProjectProperties(
  path: string,
): Promise<ProjectProperties> {
  return invoke("get_project_properties", { path });
}

export async function setProjectProperties(
  path: string,
  about: string,
): Promise<ProjectProperties> {
  return invoke("set_project_properties", { path, about });
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function joinPath(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent.replace(/\/$/, "")}/${name}`;
}

export function parentPath(path: string): string {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  const i = cleaned.lastIndexOf("/");
  return i === -1 ? "" : cleaned.slice(0, i);
}

/**
 * A MarkSpace "project" is a first-level folder under the vault root
 * (path has no `/`). Nested folders are ordinary folders, not projects.
 */
export function isVaultProjectFolder(path: string, isDir: boolean): boolean {
  return isDir && path.length > 0 && !path.includes("/");
}

/** First-level project folders from a vault tree root. */
export function listVaultProjects(
  tree: TreeNode | null | undefined,
): { path: string; name: string }[] {
  return (tree?.children ?? [])
    .filter((n) => isVaultProjectFolder(n.path, n.isDir))
    .map((n) => ({ path: n.path, name: n.name }));
}

export type DocumentKind = "markdown" | "drawio";

export function documentKind(path: string): DocumentKind {
  return path.toLowerCase().endsWith(".drawio") ? "drawio" : "markdown";
}

export function isDrawioPath(path: string): boolean {
  return documentKind(path) === "drawio";
}

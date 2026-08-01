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

export type FileBytesResult = {
  path: string;
  dataBase64: string;
  byteLength: number;
};

export async function readFileBytes(path: string): Promise<FileBytesResult> {
  return invoke("read_file_bytes", { path });
}

export async function writeFileBytes(
  path: string,
  data: Uint8Array,
): Promise<string> {
  return invoke("write_file_bytes", {
    path,
    dataBase64: uint8ToBase64(data),
  });
}

export type HttpFetchBytesResult = {
  status: number;
  contentType: string | null;
  dataBase64: string;
  byteLength: number;
};

export async function httpFetchBytes(url: string): Promise<HttpFetchBytesResult> {
  return invoke("http_fetch_bytes", {
    req: { url, method: "GET", headers: null, body: null },
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

/** Unique note tags (frontmatter ∪ inline `#tags`) from the in-memory vault index. */
export async function listVaultTags(): Promise<string[]> {
  return invoke("list_vault_tags");
}

/** Re-read one note into the tag index; returns full catalog. */
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

/** Reserved vault-root folder for agent skills (one .md file per skill). */
export const SKILLS_FOLDER = "Skills";

/** True for the protected root-level Skills/ folder. */
export function isSkillsFolder(path: string, isDir = true): boolean {
  return isDir && path === SKILLS_FOLDER;
}

/** Skill id = filename stem under Skills/ (lowercase letters, digits, hyphens). */
export function isValidSkillId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 64 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
  );
}

/** `Skills/foo.md` → `foo`; otherwise null. */
export function skillIdFromPath(path: string): string | null {
  if (!path.startsWith(`${SKILLS_FOLDER}/`)) return null;
  const rest = path.slice(SKILLS_FOLDER.length + 1);
  if (!rest || rest.includes("/") || !rest.toLowerCase().endsWith(".md")) {
    return null;
  }
  return rest.slice(0, -3);
}

export function skillPathForId(id: string): string {
  return `${SKILLS_FOLDER}/${id}.md`;
}

/**
 * A MarkSpace "project" is a first-level folder under the vault root
 * (path has no `/`). Nested folders are ordinary folders, not projects.
 * The reserved Skills/ folder is not a project.
 */
export function isVaultProjectFolder(path: string, isDir: boolean): boolean {
  return (
    isDir &&
    path.length > 0 &&
    !path.includes("/") &&
    !isSkillsFolder(path, true)
  );
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

import { invoke } from "@tauri-apps/api/core";
import type { DayMarker } from "./dayMarkers";
import { normalizeMarkdown } from "./normalizeMarkdown";
import { stampNoteTimestamps } from "./noteFrontmatter";
import { normalizeProjectColor } from "./projectColors";

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

function skipMarkdownNormalize(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".drawio") ||
    lower.endsWith(".mdlnks") ||
    lower.endsWith(".mddict") ||
    lower.endsWith(".mdhabit")
  );
}

export async function readNote(path: string): Promise<string> {
  const raw = await invoke<string>("read_note", { path });
  // Don't run markdown fence healing on draw.io / links files.
  if (skipMarkdownNormalize(path)) return raw;
  return normalizeMarkdown(raw);
}

export async function writeNote(path: string, content: string): Promise<string> {
  const normalized = skipMarkdownNormalize(path)
    ? content
    : normalizeMarkdown(content);
  const payload = path.toLowerCase().endsWith(".md")
    ? stampNoteTimestamps(normalized)
    : normalized;
  await invoke("write_note", { path, content: payload });
  return payload;
}

export async function createNote(path: string): Promise<string> {
  const created = await invoke<string>("create_note", { path });
  const initialContent = await readNote(created);
  await writeNote(created, initialContent);
  return created;
}

export async function createDrawio(path: string): Promise<string> {
  return invoke("create_drawio", { path });
}

export async function createMdlnks(path: string): Promise<string> {
  return invoke("create_mdlnks", { path });
}

export async function createMddict(path: string): Promise<string> {
  return invoke("create_mddict", { path });
}

export async function createMdhabit(
  path: string,
  year: number,
  created: string,
): Promise<string> {
  return invoke("create_mdhabit", { path, year, created });
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
  overwrite = false,
): Promise<string[]> {
  return invoke("import_paths", { parent, sources, overwrite });
}

/** Write a .md / .drawio / .mdlnks / .mddict / .mdhabit / .pdf from bytes into a vault folder. */
export async function importDocumentBytes(
  parent: string,
  fileName: string,
  data: Uint8Array,
  overwrite = false,
): Promise<string> {
  return invoke("import_document_bytes", {
    parent,
    fileName,
    dataBase64: uint8ToBase64(data),
    overwrite,
  });
}

export async function createFolder(path: string): Promise<string> {
  return invoke("create_folder", { path });
}

export type EnsureFolderResult = {
  path: string;
  created: boolean;
};

/** Create folder (and parents) if missing; `created` is false when it already existed. */
export async function ensureFolder(path: string): Promise<EnsureFolderResult> {
  return invoke("ensure_folder", { path });
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

export type PromoteNoteToFolderResult = {
  folder: string;
  folderNote: string;
  formerNote: string;
};

export type NestUnderNoteResult = {
  folder: string;
  folderNote: string;
  moved: string;
  formerNote: string;
};

/** Turn `note` (.md) into a folder with `{stem}/.folder.md` as the overview. */
export async function promoteNoteToFolder(
  note: string,
): Promise<PromoteNoteToFolderResult> {
  return invoke("promote_note_to_folder", { note });
}

/** Promote `note` (.md) to a folder with `.folder.md`, then move `from` into it. */
export async function nestUnderNote(
  from: string,
  note: string,
  toIndex: number,
): Promise<NestUnderNoteResult> {
  return invoke("nest_under_note", { from, note, toIndex });
}

export async function deletePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

export type DeleteFolderIfEmptyResult = {
  path: string;
  deleted: boolean;
  /** When not deleted: `not_found` | `not_a_folder` | `not_empty` | `protected`. */
  reason?: string | null;
};

/** Delete a folder only if it is truly empty (no files, including `.assets`). */
export async function deleteFolderIfEmpty(
  path: string,
): Promise<DeleteFolderIfEmptyResult> {
  return invoke("delete_folder_if_empty", { path });
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

export async function httpFetchBytes(
  url: string,
  opts?: { timeoutSecs?: number },
): Promise<HttpFetchBytesResult> {
  return invoke("http_fetch_bytes", {
    req: {
      url,
      method: "GET",
      headers: null,
      body: null,
      timeoutSecs: opts?.timeoutSecs ?? null,
    },
  });
}

export type RunTerminalResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cwd: string;
  timedOut: boolean;
  truncated: boolean;
  killed: boolean;
  error?: string | null;
};

export async function runTerminalCommand(input: {
  jobId: string;
  command: string;
  cwd?: string | null;
  timeoutMs?: number | null;
}): Promise<RunTerminalResult> {
  return invoke("run_terminal_command", {
    jobId: input.jobId,
    command: input.command,
    cwd: input.cwd ?? null,
    timeoutMs: input.timeoutMs ?? null,
  });
}

/** Kill a running terminal job (process group). Returns false if already gone. */
export async function killTerminalCommand(jobId: string): Promise<boolean> {
  return invoke("kill_terminal_command", { jobId });
}

export type SearchHit = {
  path: string;
  line: number;
  snippet: string;
  /** 1-based page for PDF hits. */
  page?: number;
};

export async function searchNotes(query: string): Promise<SearchHit[]> {
  return invoke("search_notes", { query });
}

export type PdfTextExtract = {
  path: string;
  pageCount: number;
  text: string;
  pages: string[];
  truncated: boolean;
};

/** Extract plain text from a vault PDF (Rust pdf-extract). */
export async function extractPdfText(path: string): Promise<PdfTextExtract> {
  return invoke("extract_pdf_text_cmd", { path });
}

export type SemanticSearchHit = {
  path: string;
  score: number;
  snippet: string;
  heading?: string;
  startLine: number;
};

export type EmbeddingsIndexStatus = {
  modelAvailable: boolean;
  ready: boolean;
  modelId: string;
  indexedFiles: number;
  pendingFiles: number;
  indexing: boolean;
  progress: number;
  error?: string;
};

/** Local semantic (embedding) search over vault notes. */
export async function semanticSearchNotes(
  query: string,
  limit?: number,
): Promise<SemanticSearchHit[]> {
  return invoke("semantic_search_notes", { query, limit });
}

export async function getEmbeddingsIndexStatus(): Promise<EmbeddingsIndexStatus> {
  return invoke("get_embeddings_index_status");
}

export type EmbeddingModelStatus = {
  installed: boolean;
  downloading: boolean;
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
  modelId: string;
  error?: string;
};

export async function getEmbeddingModelStatus(): Promise<EmbeddingModelStatus> {
  return invoke("get_embedding_model_status");
}

export async function downloadEmbeddingModel(): Promise<EmbeddingModelStatus> {
  return invoke("download_embedding_model");
}

/** Unique note tags (frontmatter ∪ inline `#tags`) from the in-memory vault index. */
export async function listVaultTags(): Promise<string[]> {
  return invoke("list_vault_tags");
}

export type DiaryDayMarker = {
  date: string;
  marker: string;
};

/** Daily-note YAML `marker:` values under a diary project. */
export async function listDiaryDayMarkers(
  project: string,
): Promise<DiaryDayMarker[]> {
  return invoke("list_diary_day_markers", { project });
}

/** Unique tags from all `.mddict` files (separate from note/PDF vault tags). */
export async function listDictionaryTags(): Promise<string[]> {
  return invoke("list_dictionary_tags");
}

/** One note's path and its tags from the in-memory vault index. */
export type NoteTags = {
  path: string;
  tags: string[];
};

/** Full path → tags map for the tag graph (only notes that have at least one tag). */
export async function listNoteTags(): Promise<NoteTags[]> {
  return invoke("list_note_tags");
}

/** Re-read one note into the tag index; returns full catalog. */
export async function reindexNoteTags(path: string): Promise<string[]> {
  return invoke("reindex_note_tags", { path });
}

/** Tags for a vault file stored in `.markspace/filemeta/` (e.g. PDF). */
export async function getFileTags(path: string): Promise<string[]> {
  return invoke("get_file_tags", { path });
}

/** Set tags for a vault file (sidecar). Empty list removes the sidecar. */
export async function setFileTags(
  path: string,
  tags: string[],
): Promise<string[]> {
  return invoke("set_file_tags", { path, tags });
}

/** Text comment anchored to a quote in a markdown note. */
export type StructuralAnchor = {
  kind: "text" | "leaf" | "span";
  startHash: string;
  startType: string;
  startOcc: number;
  startOffset: number;
  endHash: string;
  endType: string;
  endOcc: number;
  endOffset: number;
  leafType?: string;
  leafKey?: string;
};

export type NoteComment = {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  /** Structural location in Live doc; quote is label + fallback. */
  anchor?: StructuralAnchor | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Inbox row: comment plus its note path. */
export type CommentRef = {
  notePath: string;
  comment: NoteComment;
};

export type UpsertCommentInput = {
  id?: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  anchor?: StructuralAnchor | null;
  body: string;
  resolved?: boolean;
};

function normalizeAnchor(raw: unknown): StructuralAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const kind = a.kind;
  if (kind !== "text" && kind !== "leaf" && kind !== "span") return null;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const opt = (v: unknown) => {
    const s = str(v);
    return s ? s : undefined;
  };
  return {
    kind,
    startHash: str(a.startHash),
    startType: str(a.startType),
    startOcc: num(a.startOcc),
    startOffset: num(a.startOffset),
    endHash: str(a.endHash),
    endType: str(a.endType),
    endOcc: num(a.endOcc),
    endOffset: num(a.endOffset),
    leafType: opt(a.leafType),
    leafKey: opt(a.leafKey),
  };
}

function normalizeComment(raw: NoteComment): NoteComment {
  return {
    id: raw.id,
    quote: raw.quote ?? "",
    prefix: raw.prefix ?? "",
    suffix: raw.suffix ?? "",
    anchor: normalizeAnchor(raw.anchor),
    body: raw.body ?? "",
    resolved: Boolean(raw.resolved),
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
}

export async function listNoteComments(path: string): Promise<NoteComment[]> {
  const rows = await invoke<NoteComment[]>("list_note_comments", { path });
  return rows.map(normalizeComment);
}

export async function listAllComments(): Promise<CommentRef[]> {
  const rows = await invoke<CommentRef[]>("list_all_comments");
  return rows.map((r) => ({
    notePath: r.notePath,
    comment: normalizeComment(r.comment),
  }));
}

export async function upsertNoteComment(
  path: string,
  comment: UpsertCommentInput,
): Promise<NoteComment> {
  const raw = await invoke<NoteComment>("upsert_note_comment", {
    path,
    comment: {
      id: comment.id ?? "",
      quote: comment.quote,
      prefix: comment.prefix ?? "",
      suffix: comment.suffix ?? "",
      anchor: comment.anchor ?? undefined,
      body: comment.body,
      resolved: comment.resolved,
    },
  });
  return normalizeComment(raw);
}

export async function deleteNoteComment(
  path: string,
  id: string,
): Promise<void> {
  await invoke("delete_note_comment", { path, id });
}

export async function setCommentResolved(
  path: string,
  id: string,
  resolved: boolean,
): Promise<NoteComment> {
  const raw = await invoke<NoteComment>("set_comment_resolved", {
    path,
    id,
    resolved,
  });
  return normalizeComment(raw);
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

/** Project type stored in `.markspace/projects/*.json` (`""` = unset). */
export type ProjectTypeId =
  | ""
  | "knowledgeBase"
  | "languageLearning"
  | "diary";

export const PROJECT_TYPE_OPTIONS: {
  value: ProjectTypeId;
  label: string;
}[] = [
  { value: "", label: "None" },
  { value: "knowledgeBase", label: "Knowledge base" },
  { value: "languageLearning", label: "Foreign language learning" },
  { value: "diary", label: "Diary" },
];

export function projectTypeLabel(type: ProjectTypeId | string): string {
  return PROJECT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? "";
}

export function isProjectTypeId(value: unknown): value is ProjectTypeId {
  return (
    value === "" ||
    value === "knowledgeBase" ||
    value === "languageLearning" ||
    value === "diary"
  );
}

export type ProjectProperties = {
  path: string;
  /** Free-form description ("What is this project about"). */
  about: string;
  /** `""` | `knowledgeBase` | `languageLearning` | `diary`. */
  projectType: ProjectTypeId;
  /** ISO 639-1 code when type is language learning; otherwise empty. */
  learningLanguage: string;
  /** Material swatch hex (`#rrggbb`); empty = unset. */
  color: string;
};

export function emptyProjectProperties(path: string): ProjectProperties {
  return {
    path,
    about: "",
    projectType: "",
    learningLanguage: "",
    color: "",
  };
}

function normalizeLoadedProjectProperties(
  raw: ProjectProperties,
): ProjectProperties {
  const projectType = isProjectTypeId(raw.projectType) ? raw.projectType : "";
  return {
    path: raw.path,
    about: raw.about ?? "",
    projectType,
    learningLanguage:
      projectType === "languageLearning"
        ? (raw.learningLanguage ?? "").trim()
        : "",
    color: normalizeProjectColor(raw.color),
  };
}

export async function getProjectProperties(
  path: string,
): Promise<ProjectProperties> {
  const raw = await invoke<ProjectProperties>("get_project_properties", {
    path,
  });
  return normalizeLoadedProjectProperties(raw);
}

export async function setProjectProperties(
  path: string,
  props: {
    about: string;
    projectType: ProjectTypeId;
    learningLanguage: string;
    color: string;
  },
): Promise<ProjectProperties> {
  const projectType = isProjectTypeId(props.projectType) ? props.projectType : "";
  const learningLanguage =
    projectType === "languageLearning"
      ? props.learningLanguage.trim()
      : "";
  const color = normalizeProjectColor(props.color);
  const raw = await invoke<ProjectProperties>("set_project_properties", {
    path,
    about: props.about,
    projectType,
    learningLanguage,
    color,
  });
  return normalizeLoadedProjectProperties(raw);
}

export async function listProjectProperties(): Promise<ProjectProperties[]> {
  const raw = await invoke<ProjectProperties[]>("list_project_properties");
  return (raw ?? []).map(normalizeLoadedProjectProperties);
}

/** Durable agent memory entry (global or project-scoped). */
export type AgentMemoryEntry = {
  id: string;
  text: string;
  /** `null` / omitted = global; otherwise first-level project folder. */
  projectPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentMemoryDoc = {
  version: number;
  enabled: boolean;
  entries: AgentMemoryEntry[];
};

function normalizeAgentMemoryEntry(raw: AgentMemoryEntry): AgentMemoryEntry {
  const projectPath = raw.projectPath?.trim() || null;
  return {
    id: raw.id,
    text: raw.text ?? "",
    projectPath,
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? "",
  };
}

function normalizeAgentMemoryDoc(raw: AgentMemoryDoc): AgentMemoryDoc {
  return {
    version: raw.version ?? 1,
    enabled: raw.enabled !== false,
    entries: (raw.entries ?? []).map(normalizeAgentMemoryEntry),
  };
}

export async function getAgentMemory(): Promise<AgentMemoryDoc> {
  const raw = await invoke<AgentMemoryDoc>("get_agent_memory");
  return normalizeAgentMemoryDoc(raw);
}

export async function setAgentMemoryEnabled(
  enabled: boolean,
): Promise<AgentMemoryDoc> {
  const raw = await invoke<AgentMemoryDoc>("set_agent_memory_enabled", {
    enabled,
  });
  return normalizeAgentMemoryDoc(raw);
}

export async function addAgentMemory(
  text: string,
  projectPath?: string | null,
): Promise<AgentMemoryEntry> {
  const raw = await invoke<AgentMemoryEntry>("add_agent_memory", {
    text,
    projectPath: projectPath?.trim() || null,
  });
  return normalizeAgentMemoryEntry(raw);
}

export async function updateAgentMemory(
  id: string,
  text: string,
  projectPath?: string | null,
): Promise<AgentMemoryEntry> {
  const raw = await invoke<AgentMemoryEntry>("update_agent_memory", {
    id,
    text,
    projectPath: projectPath?.trim() || null,
  });
  return normalizeAgentMemoryEntry(raw);
}

export async function deleteAgentMemory(id: string): Promise<void> {
  await invoke("delete_agent_memory", { id });
}

export type ClearAgentMemoryKind = "all" | "global" | "project";

export async function clearAgentMemory(
  kind: ClearAgentMemoryKind,
  project?: string | null,
): Promise<AgentMemoryDoc> {
  const raw = await invoke<AgentMemoryDoc>("clear_agent_memory", {
    args: {
      kind,
      project: project?.trim() || null,
    },
  });
  return normalizeAgentMemoryDoc(raw);
}

export type DiarySettings = {
  version: number;
  /** `null`/`undefined` = use built-in defaults. */
  markers?: DayMarker[] | null;
};

export async function getDiarySettings(): Promise<DiarySettings> {
  return invoke<DiarySettings>("get_diary_settings");
}

export async function setDiarySettings(
  markers: DayMarker[],
): Promise<DiarySettings> {
  return invoke<DiarySettings>("set_diary_settings", {
    args: { markers },
  });
}

export type VaultAiSettingsDoc = {
  version: number;
  chatModelId?: string | null;
  workerModelId?: string | null;
};

export async function getVaultAiSettings(): Promise<VaultAiSettingsDoc> {
  return invoke<VaultAiSettingsDoc>("get_vault_ai_settings");
}

export async function setVaultAiSettings(args: {
  chatModelId: string | null;
  workerModelId: string | null;
}): Promise<VaultAiSettingsDoc> {
  return invoke<VaultAiSettingsDoc>("set_vault_ai_settings", {
    args: {
      chatModelId: args.chatModelId,
      workerModelId: args.workerModelId,
    },
  });
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

/** Hidden overview note inside a folder (not shown in the sidebar tree). */
export const FOLDER_NOTE_NAME = ".folder.md";

/** True for `{folder}/.folder.md` (any depth). */
export function isFolderNotePath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  return name.toLowerCase() === FOLDER_NOTE_NAME;
}

/** Vault-relative path of the folder note for `folder` (not for vault root). */
export function folderNotePath(folder: string): string {
  const cleaned = folder.replace(/^\/+|\/+$/g, "");
  return joinPath(cleaned, FOLDER_NOTE_NAME);
}

/** Parent folder of a folder note, or null if `path` is not a folder note. */
export function folderPathFromFolderNote(path: string): string | null {
  if (!isFolderNotePath(path)) return null;
  return parentPath(path);
}

/**
 * Sidebar tree row to reveal for an open editor path.
 * Hidden folder notes (`{folder}/.folder.md`) are not listed in the tree.
 */
export function treeRevealTarget(path: string): {
  treePath: string;
  isDir: boolean;
} | null {
  if (!path) return null;
  const folder = folderPathFromFolderNote(path);
  // `""` is the vault root (e.g. `.folder.md` at the vault root).
  if (folder != null) return { treePath: folder, isDir: true };
  return { treePath: path, isDir: false };
}

/** Create `{folder}/.folder.md` if missing; return its vault-relative path. */
export async function ensureFolderNote(folder: string): Promise<string> {
  return invoke("ensure_folder_note", { folder });
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

export type DocumentKind =
  | "markdown"
  | "drawio"
  | "mdlnks"
  | "mddict"
  | "mdhabit"
  | "pdf";

export function documentKind(path: string): DocumentKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".drawio")) return "drawio";
  if (lower.endsWith(".mdlnks")) return "mdlnks";
  if (lower.endsWith(".mddict")) return "mddict";
  if (lower.endsWith(".mdhabit")) return "mdhabit";
  if (lower.endsWith(".pdf")) return "pdf";
  return "markdown";
}

export function isDrawioPath(path: string): boolean {
  return documentKind(path) === "drawio";
}

export function isMdlnksPath(path: string): boolean {
  return documentKind(path) === "mdlnks";
}

export function isMddictPath(path: string): boolean {
  return documentKind(path) === "mddict";
}

export function isMdhabitPath(path: string): boolean {
  return documentKind(path) === "mdhabit";
}

export function isPdfPath(path: string): boolean {
  return documentKind(path) === "pdf";
}

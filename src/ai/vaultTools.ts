import { tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  createFolder,
  createNote,
  deleteFolderIfEmpty,
  ensureFolder,
  extractPdfText,
  getEmbeddingModelStatus,
  getFileTags,
  listNoteTags,
  listTree,
  listVaultTags,
  parentPath,
  projectTypeLabel,
  readNote,
  searchNotes,
  semanticSearchNotes,
  setFileTags,
  writeAsset,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import {
  formatDailyNoteStem,
  parseIsoDateOnly,
  resolveDiaryProjectRoot,
  startOfLocalDay,
} from "../lib/diaryNotes";
import { useSidebarUiStore } from "../store/sidebarUiStore";
import { useVaultStore } from "../store/vaultStore";
import {
  dataUrlToBytes,
  findAttachmentFilePart,
} from "./chatAttachments";
import { buildAskUserTool } from "./askUser";
import { buildDrawioTools } from "./drawio/tools";
import { buildMdlnksTools } from "./mdlnks/tools";
import { mdlnksCoreRules } from "./mdlnksFormat";
import { buildMddictTools } from "./mddict/tools";
import { mddictCoreRules } from "./mddictFormat";
import { clipArticle } from "./clipArticle";
import { buildFileTools } from "./fileTools";
import {
  MARKDOWN_FORMAT_GUIDE,
  markdownCoreRules,
} from "./markdownFormat";
import {
  formatForcedSkillsLines,
  formatSkillsCatalogLines,
  loadSkill,
  type LoadedSkill,
  type SkillMeta,
} from "./skills";
import { formatForcedToolsLines } from "./toolCatalog";
import type { ChatMode } from "./types";
import { buildWebTools } from "./webTools";
import {
  isNativeLanguageId,
  nativeLanguageLabel,
  NATIVE_LANGUAGE_OPTIONS,
} from "../settings/types";
import { useAiSettingsStore } from "../store/aiSettingsStore";
import { usePrefsStore } from "../store/prefsStore";
import { translateNoteInPlaceWithJob } from "./translateNote";

const TRANSLATE_LANGUAGE_ENUM = z.enum(
  NATIVE_LANGUAGE_OPTIONS.map((o) => o.value) as [
    (typeof NATIVE_LANGUAGE_OPTIONS)[number]["value"],
    ...(typeof NATIVE_LANGUAGE_OPTIONS)[number]["value"][],
  ],
);

const MAX_WRITE_ASSET_BYTES = 10 * 1024 * 1024;

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Let the browser paint chat UI between heavy tool steps. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function flattenPaths(node: TreeNode, out: string[] = []): string[] {
  if (!node.isDir && node.path) out.push(node.path);
  for (const child of node.children ?? []) flattenPaths(child, out);
  return out;
}

function normalizeToolPath(path: string): string {
  return path.trim().replace(/^\/+/, "");
}

/** True when path is inside the active project (or always true if no project). */
function makeInProject(projectPath: string | null): (path: string) => boolean {
  if (!projectPath) return () => true;
  const prefix = `${projectPath}/`;
  return (p: string) => p === projectPath || p.startsWith(prefix);
}

type FolderEntry = {
  path: string;
  name: string;
  kind: "folder" | "file";
};

const MAX_FOLDER_LIST = 500;

/** Resolve a vault-relative folder path inside the tree root ("" = vault root). */
function findFolderNode(root: TreeNode, folderPath: string): TreeNode | null {
  const rel = normalizeToolPath(folderPath).replace(/\/+$/, "");
  if (!rel) return root;
  const parts = rel.split("/").filter(Boolean);
  let cur: TreeNode = root;
  for (const part of parts) {
    const next = (cur.children ?? []).find((c) => c.isDir && c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function collectFolderEntries(
  folder: TreeNode,
  recursive: boolean,
  out: FolderEntry[] = [],
): FolderEntry[] {
  for (const child of folder.children ?? []) {
    if (out.length >= MAX_FOLDER_LIST) break;
    out.push({
      path: child.path,
      name: child.name,
      kind: child.isDir ? "folder" : "file",
    });
    if (recursive && child.isDir) {
      collectFolderEntries(child, true, out);
    }
  }
  return out;
}

/** @internal exported for unit tests */
export const _test = {
  findFolderNode,
  collectFolderEntries,
  makeInProject,
  MAX_FOLDER_LIST,
};

export function buildVaultTools(
  mode: ChatMode,
  opts?: {
    getMessages?: () => UIMessage[];
    projectPath?: string | null;
  },
) {
  const getMessages = opts?.getMessages ?? (() => [] as UIMessage[]);
  const projectPath = opts?.projectPath?.trim() || null;
  const inProject = makeInProject(projectPath);

  const readTools = {
    list_notes: tool({
      description:
        "List vault-relative paths of markdown notes (and other files) in the open vault tree. When a project is selected in chat, only paths inside that project are returned.",
      inputSchema: z.object({}),
      execute: async () => {
        const tree = await listTree();
        const paths = flattenPaths(tree).filter(
          (p) =>
            (p.endsWith(".md") ||
              p.endsWith(".drawio") ||
              p.endsWith(".mdlnks") ||
              p.endsWith(".mddict") ||
              p.endsWith(".pdf")) &&
            inProject(p),
        );
        await yieldToUi();
        return { count: paths.length, paths: paths.slice(0, 500) };
      },
    }),

    list_folder: tool({
      description:
        "List the contents of a vault folder. Returns entries with kind folder or file. Use recursive=true to walk nested folders; default is immediate children only. Empty path lists the vault root, or the active project folder when a project is selected. Prefer this over list_notes when you need to see folders (including empty ones).",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Vault-relative folder path, e.g. Ideas/Archive. Omit or pass empty string for the vault root (or the active project when selected).",
          ),
        recursive: z
          .boolean()
          .optional()
          .describe("If true, include nested folders and files (default false)"),
      }),
      execute: async ({ path, recursive }) => {
        const folderPath = (
          normalizeToolPath(path ?? "") ||
          projectPath ||
          ""
        ).replace(/\/+$/, "");
        const tree = await listTree();
        const folder = findFolderNode(tree, folderPath);
        await yieldToUi();
        if (!folder) {
          return {
            ok: false as const,
            error: `Folder not found: ${folderPath || "(vault root)"}`,
          };
        }
        const entries = collectFolderEntries(folder, recursive === true);
        return {
          ok: true as const,
          path: folderPath,
          recursive: recursive === true,
          count: entries.length,
          truncated: entries.length >= MAX_FOLDER_LIST,
          entries,
        };
      },
    }),

    search_notes: tool({
      description:
        "Exact/substring search over markdown notes and text-extractable PDF documents (case-insensitive). Use for precise strings, symbols, filenames, or quoted phrases. For conceptual / meaning-based questions prefer semantic_search. PDF hits include page (1-based). When a project is selected, results are limited to that project.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
      }),
      execute: async ({ query }) => {
        const hits = (await searchNotes(query)).filter((h) =>
          inProject(h.path),
        );
        return { count: hits.length, hits };
      },
    }),

    semantic_search: tool({
      description:
        "Semantic search over vault notes and text-extractable PDFs using a separately downloaded local embedding model (meaning / paraphrases, RU and EN). Prefer this for conceptual questions like “what did I write about onboarding”. Returns path, score, snippet, optional heading; for PDFs startLine is the page number. Follow up with read_note (or read_file for PDFs) on the best hits. For exact substrings use search_notes instead. When a project is selected, results are limited to that project.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Natural-language search query"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max hits to return (default 10)"),
      }),
      execute: async ({ query, limit }) => {
        const desired = limit ?? 10;
        const fetchLimit = projectPath
          ? Math.min(desired * 4, 50)
          : limit;
        const model = await getEmbeddingModelStatus();
        if (!model.installed) {
          return {
            available: false as const,
            count: 0,
            hits: [],
            error:
              "Local semantic search model is not installed. It can be downloaded in Settings → AI.",
          };
        }
        try {
          const raw = await semanticSearchNotes(query, fetchLimit);
          const hits = raw.filter((h) => inProject(h.path)).slice(0, desired);
          await yieldToUi();
          return { available: true as const, count: hits.length, hits };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // Fallback so the agent can still answer while the index warms up.
          const hits = (await searchNotes(query))
            .filter((h) => inProject(h.path))
            .slice(0, desired);
          await yieldToUi();
          return {
            available: false as const,
            count: hits.length,
            hits,
            fallback: "substring" as const,
            warning: message,
          };
        }
      },
    }),

    list_tags: tool({
      description:
        "List the current unique document tags in the vault (markdown frontmatter / #tags and PDF filemeta tags). Use this before choosing or changing tags. When a project is selected, only tags from documents in that project are returned.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!projectPath) {
          const tags = await listVaultTags();
          await yieldToUi();
          return { count: tags.length, tags };
        }
        const notes = await listNoteTags();
        const tagSet = new Set<string>();
        for (const note of notes) {
          if (!inProject(note.path)) continue;
          for (const tag of note.tags) tagSet.add(tag);
        }
        const tags = [...tagSet].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
        await yieldToUi();
        return { count: tags.length, tags };
      },
    }),

    get_file_tags: tool({
      description:
        "Read tags for a vault file that uses filemeta sidecars (currently PDFs). For markdown notes prefer read_note and inspect YAML tags / #tags instead.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative path, e.g. Docs/spec.pdf"),
      }),
      execute: async ({ path }) => {
        const rel = normalizeToolPath(path);
        if (!rel) return { ok: false as const, error: "Path required" };
        const tags = await getFileTags(rel);
        await yieldToUi();
        return { ok: true as const, path: rel, tags };
      },
    }),

    read_note: tool({
      description:
        "Read a note by vault-relative path. Prefer start_line/end_line to read only a slice and save tokens; omit both to read the full file (capped). For .pdf files returns extracted plain text (scanned PDFs may be empty); start_line/end_line then mean 1-based page numbers.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative path, e.g. Folder/Note.md"),
        start_line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based start line (inclusive); for PDFs = start page"),
        end_line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based end line (inclusive); for PDFs = end page"),
      }),
      execute: async ({ path, start_line: startLine, end_line: endLine }) => {
        const rel = normalizeToolPath(path);
        if (rel.toLowerCase().endsWith(".pdf")) {
          const extracted = await extractPdfText(rel);
          await yieldToUi();
          const pages = extracted.pages;
          if (startLine != null || endLine != null) {
            const start = Math.max(1, startLine ?? 1);
            const end = Math.min(pages.length, endLine ?? pages.length);
            if (pages.length === 0) {
              return {
                path: rel,
                kind: "pdf" as const,
                page_count: 0,
                content: "",
                note: "No extractable text (scanned or empty PDF)",
              };
            }
            if (start > end) {
              return {
                ok: false as const,
                error: `Invalid range: start_line ${start} > end_line ${end}`,
                page_count: pages.length,
              };
            }
            const slice = pages
              .slice(start - 1, end)
              .map((t, i) => `--- Page ${start + i} ---\n${t}`)
              .join("\n\n");
            return {
              path: rel,
              kind: "pdf" as const,
              start_page: start,
              end_page: end,
              page_count: pages.length,
              content: slice,
            };
          }
          const max = 80_000;
          const text = extracted.text;
          if (!text.trim()) {
            return {
              path: rel,
              kind: "pdf" as const,
              page_count: extracted.pageCount,
              content: "",
              note: "No extractable text (scanned or empty PDF)",
            };
          }
          if (text.length > max) {
            return {
              path: rel,
              kind: "pdf" as const,
              truncated: true,
              page_count: extracted.pageCount,
              content: text.slice(0, max),
            };
          }
          return {
            path: rel,
            kind: "pdf" as const,
            truncated: extracted.truncated,
            page_count: extracted.pageCount,
            content: text,
          };
        }

        const content = await readNote(rel);
        const lines = content.split("\n");
        await yieldToUi();
        if (startLine != null || endLine != null) {
          const start = Math.max(1, startLine ?? 1);
          const end = Math.min(lines.length, endLine ?? lines.length);
          if (start > end) {
            return {
              ok: false as const,
              error: `Invalid range: start_line ${start} > end_line ${end}`,
              line_count: lines.length,
            };
          }
          const slice = lines.slice(start - 1, end).join("\n");
          return {
            path: rel,
            start_line: start,
            end_line: end,
            line_count: lines.length,
            content: slice,
          };
        }
        const max = 80_000;
        if (content.length > max) {
          return {
            path: rel,
            truncated: true,
            line_count: lines.length,
            content: content.slice(0, max),
          };
        }
        return {
          path: rel,
          truncated: false,
          line_count: lines.length,
          content,
        };
      },
    }),

    get_active_note: tool({
      description:
        "Get the currently open note path and content from the editor (may be unsaved). Prefer this before editing the open file.",
      inputSchema: z.object({
        start_line: z.number().int().min(1).optional(),
        end_line: z.number().int().min(1).optional(),
      }),
      execute: async ({ start_line: startLine, end_line: endLine }) => {
        const { activePath, content, dirty } = useVaultStore.getState();
        if (!activePath) {
          return { open: false as const };
        }
        const lines = content.split("\n");
        if (startLine != null || endLine != null) {
          const start = Math.max(1, startLine ?? 1);
          const end = Math.min(lines.length, endLine ?? lines.length);
          return {
            open: true as const,
            path: activePath,
            dirty,
            start_line: start,
            end_line: end,
            line_count: lines.length,
            content: lines.slice(start - 1, end).join("\n"),
          };
        }
        return {
          open: true as const,
          path: activePath,
          dirty,
          line_count: lines.length,
          content: content.slice(0, 80_000),
        };
      },
    }),

    open_note: tool({
      description:
        "Open a vault file in the editor as a tab, activate it if already open, and reveal it in the file tree. Use when the user asks to open/show/switch to a note, diagram, or PDF, or when they should see the file you are discussing. Does not replace read_note for reading contents. For PDFs, pass page to jump to a 1-based page.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Vault-relative path, e.g. Folder/Note.md, diagram.drawio, or report.pdf",
          ),
        preview: z
          .boolean()
          .optional()
          .describe(
            "If true (default), open as a preview tab (replaced by the next preview). If false, open as a pinned tab.",
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based PDF page to open (ignored for non-PDF files)"),
      }),
      execute: async ({ path, preview, page }) => {
        const rel = normalizeToolPath(path);
        if (!rel) {
          return { ok: false as const, error: "Path required" };
        }
        const store = useVaultStore.getState();
        const wasOpen = store.tabs.some((t) => t.path === rel);
        const wasActive = store.activePath === rel;
        const asPreview = preview !== false;

        await store.openNote(rel, {
          preview: asPreview,
          ...(page != null ? { page } : {}),
        });
        await yieldToUi();

        const after = useVaultStore.getState();
        if (after.activePath !== rel) {
          return {
            ok: false as const,
            error: after.error ?? `Could not open ${rel}`,
          };
        }
        useSidebarUiStore.getState().revealPathInTree(rel);
        const tab = after.tabs.find((t) => t.path === rel);
        return {
          ok: true as const,
          path: rel,
          already_open: wasOpen,
          already_active: wasActive,
          preview: Boolean(tab?.preview),
          ...(page != null ? { page } : {}),
        };
      },
    }),

    read_format_guide: tool({
      description:
        "Return the full MarkSpace Markdown dialect specification (wiki-links, Draw.io embeds, image widths, tables, diagrams, unsupported syntax). Call when unsure how to write or edit note markdown, or before non-trivial markdown edits.",
      inputSchema: z.object({}),
      execute: async () => ({
        guide: MARKDOWN_FORMAT_GUIDE,
      }),
    }),

    read_skill: tool({
      description:
        "Load a vault skill by id (filename stem under Skills/). Call when a listed skill matches the user's task, before following its instructions.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe("Skill id, e.g. meeting-notes"),
      }),
      execute: async ({ name }) => {
        const loaded = await loadSkill(name.trim());
        await yieldToUi();
        if (!loaded) {
          return {
            ok: false as const,
            error: `Skill not found: ${name}`,
          };
        }
        return {
          ok: true as const,
          name: loaded.meta.id,
          path: loaded.meta.path,
          description: loaded.meta.description,
          instructions: loaded.body.slice(0, 20_000),
        };
      },
    }),
  };

  const drawioTools = buildDrawioTools(mode);
  const mdlnksTools = buildMdlnksTools(mode);
  const mddictTools = buildMddictTools(mode);
  const webTools = buildWebTools();
  const fileTools = buildFileTools(mode);
  const askUserTool = { ask_user: buildAskUserTool() };

  if (mode === "ask") {
    return {
      ...readTools,
      ...drawioTools,
      ...mdlnksTools,
      ...mddictTools,
      ...webTools,
      ...fileTools,
      ...askUserTool,
    };
  }

  return {
    ...readTools,
    ...drawioTools,
    ...mdlnksTools,
    ...mddictTools,
    ...webTools,
    ...fileTools,
    ...askUserTool,
    set_file_tags: tool({
      description:
        "Set tags for a PDF (or other filemeta-backed vault file). Replaces the full tag list. Pass an empty array to clear tags. For markdown notes, edit YAML frontmatter tags via edit_note instead.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative path, e.g. Docs/spec.pdf"),
        tags: z
          .array(z.string())
          .describe("Full tag list to store (empty clears tags)"),
      }),
      execute: async ({ path, tags }) => {
        const rel = normalizeToolPath(path);
        if (!rel) return { ok: false as const, error: "Path required" };
        if (!rel.toLowerCase().endsWith(".pdf")) {
          return {
            ok: false as const,
            error: "set_file_tags is for PDF filemeta; use edit_note for markdown tags",
          };
        }
        const saved = await setFileTags(rel, tags);
        await useVaultStore.getState().refreshVaultTags();
        await yieldToUi();
        return { ok: true as const, path: rel, tags: saved };
      },
    }),
    edit_note: tool({
      description:
        "Preferred way to change a note: replace an exact substring (old_string → new_string) without rewriting the whole file. old_string must uniquely match unless replace_all is true. Use this to save tokens instead of write_note.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative path"),
        old_string: z
          .string()
          .min(1)
          .describe("Exact text to find (include enough context to be unique)"),
        new_string: z
          .string()
          .describe("Replacement text (may be empty to delete)"),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence (default false = single match only)"),
      }),
      execute: async ({
        path,
        old_string: oldString,
        new_string: newString,
        replace_all: replaceAll,
      }) => {
        const content = await readNote(path);
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) {
          return {
            ok: false as const,
            error:
              "old_string not found. Re-read the note and use an exact contiguous excerpt.",
            path,
          };
        }
        if (!replaceAll && occurrences > 1) {
          return {
            ok: false as const,
            error: `old_string matched ${occurrences} times. Include more surrounding context, or set replace_all=true.`,
            path,
            occurrences,
          };
        }
        const next = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);
        const saved = await writeNote(path, next);
        syncOpenEditor(path, saved);
        await yieldToUi();
        return {
          ok: true as const,
          path,
          replacements: replaceAll ? occurrences : 1,
        };
      },
    }),
    write_note: tool({
      description:
        "Overwrite an entire note. Avoid for small edits — prefer edit_note to save tokens. Use only for new full rewrites or when edit_note cannot express the change.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        const saved = await writeNote(path, content);
        syncOpenEditor(path, saved);
        await yieldToUi();
        return { ok: true, path };
      },
    }),
    create_note: tool({
      description:
        "Create a new markdown note at a vault-relative path (adds .md if missing). Parent folders are created automatically. For diary daily notes use open_or_create_daily_note instead (fixed `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` layout).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Ideas/New.md"),
      }),
      execute: async ({ path }) => {
        const created = await createNote(path);
        await useVaultStore.getState().refreshTree();
        await yieldToUi();
        return { ok: true, path: created };
      },
    }),
    open_or_create_daily_note: tool({
      description:
        "Open or create a diary daily note. Layout is always `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` (English month abbr, e.g. Journal/2026/08/02.Aug.2026.md). Prefer this over create_note for dated diary entries. Defaults to today and the active diary project (chat project / selected folder / sole diary project).",
      inputSchema: z.object({
        date: z
          .string()
          .optional()
          .describe(
            "Calendar day as YYYY-MM-DD (local). Omit for today. Do not pass other formats.",
          ),
        project: z
          .string()
          .optional()
          .describe(
            "Diary project root folder (first-level vault folder with project type Diary). Omit to resolve from chat project / selection.",
          ),
      }),
      execute: async ({ date: dateInput, project: projectInput }) => {
        const day = dateInput?.trim()
          ? parseIsoDateOnly(dateInput)
          : startOfLocalDay();
        if (!day) {
          return {
            ok: false as const,
            error:
              "Invalid date. Pass YYYY-MM-DD (e.g. 2026-08-02) or omit for today.",
          };
        }

        const store = useVaultStore.getState();
        const projectPropertiesByPath = store.projectPropertiesByPath;
        const explicit = normalizeToolPath(projectInput ?? "");
        let projectRoot: string | null = null;
        if (explicit) {
          const root = explicit.split("/")[0] ?? explicit;
          if (projectPropertiesByPath[root]?.projectType === "diary") {
            projectRoot = root;
          } else {
            return {
              ok: false as const,
              error: `Not a diary project: ${root || explicit}`,
            };
          }
        } else {
          projectRoot = resolveDiaryProjectRoot({
            selectedFolderPath: store.selectedFolderPath,
            activePath: store.activePath,
            chatProjectPath: projectPath,
            projectPropertiesByPath,
          });
        }

        if (!projectRoot) {
          return {
            ok: false as const,
            error:
              "No diary project resolved. Pass project= (Diary project folder) or select a diary project in chat / the file tree.",
          };
        }

        const result = await store.openOrCreateDailyNote(projectRoot, day);
        await yieldToUi();
        if (!result) {
          return {
            ok: false as const,
            error:
              useVaultStore.getState().error ??
              "Could not open or create daily note",
            project: projectRoot,
            date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
          };
        }

        return {
          ok: true as const,
          path: result.path,
          created: result.created,
          project: projectRoot,
          date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
          title: formatDailyNoteStem(day),
        };
      },
    }),
    translate_note: tool({
      description:
        "Smart-translate a markdown note in place (overwrites the same file). Preserves YAML frontmatter and inline #tags; only the note body is translated via LLM. Defaults to the user's native language from Settings → Profile. Prefer this over write_note/edit_note when the user asks to translate a note. Context-menu Translate still creates a sibling .XX copy — this tool replaces content.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Vault-relative .md path. Omit to translate the currently open note.",
          ),
        language: TRANSLATE_LANGUAGE_ENUM.optional().describe(
          "ISO 639-1 target language. Omit to use Profile native language.",
        ),
      }),
      execute: async ({ path, language }) => {
        const store = useVaultStore.getState();
        const target = normalizeToolPath(path ?? "") || store.activePath || "";
        if (!target) {
          return {
            ok: false as const,
            error: "No note path given and no note is open",
          };
        }
        if (!target.toLowerCase().endsWith(".md")) {
          return {
            ok: false as const,
            error: "Only markdown (.md) notes can be translated",
            path: target,
          };
        }
        const lang =
          language && isNativeLanguageId(language)
            ? language
            : usePrefsStore.getState().prefs.nativeLanguage;
        try {
          const result = await translateNoteInPlaceWithJob({
            sourcePath: target,
            targetLanguage: lang,
          });
          await yieldToUi();
          return {
            ok: true as const,
            path: result.path,
            language: result.language,
            language_label: nativeLanguageLabel(result.language),
            mode: "in_place" as const,
          };
        } catch (err) {
          await yieldToUi();
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false as const,
            error: msg || "Translation failed",
            path: target,
            language: lang,
          };
        }
      },
    }),
    clip_article: tool({
      description:
        "Save a web article into the vault as a markdown note, downloading images into the note's .assets/ folder and rewriting links to local paths. Use when the user wants to clip/save/archive a page (not for a quick read — prefer fetch_url). Then open_note on the returned path.",
      inputSchema: z.object({
        url: z.string().url().describe("http(s) URL of the article"),
        folder: z
          .string()
          .optional()
          .describe(
            "Vault-relative folder for the new note (e.g. Research/Inbox). Filename is derived from the title. Ignored if path is set. If omitted, uses Clippings/ (or <project>/Clippings/ when a project is selected).",
          ),
        path: z
          .string()
          .optional()
          .describe(
            "Optional full vault-relative note path (e.g. Project/Clippings/My Article.md). Overrides folder when set.",
          ),
        title: z
          .string()
          .optional()
          .describe("Optional note title / filename stem override"),
        download_images: z
          .boolean()
          .optional()
          .describe("Download remote images into .assets/ (default true)"),
        max_images: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe("Max images to download (default 20)"),
        provider: z
          .enum(["firecrawl", "tavily", "jina"])
          .optional()
          .describe(
            "Fetch backend. Omit to auto-pick Tavily → Jina (same as fetch_url). Pass firecrawl when the user wants Firecrawl for the clip (see system prompt for whether the Firecrawl key is configured). Prefer scrape_url for a read-only Firecrawl scrape without saving.",
          ),
      }),
      execute: async ({
        url,
        folder,
        path,
        title,
        download_images: downloadImages,
        max_images: maxImages,
        provider,
      }) => {
        const result = await clipArticle({
          url,
          folder,
          path,
          title,
          download_images: downloadImages,
          max_images: maxImages,
          provider,
          defaultFolder: projectPath,
        });
        await yieldToUi();
        return result;
      },
    }),
    create_folder: tool({
      description:
        "Create an empty folder at a vault-relative path (creates parents as needed). Fails if the folder already exists — prefer ensure_folder when you only need the path to exist. Use when the user wants a folder without a note; for a note inside a new path prefer create_note.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Desired folder path, e.g. Ideas/Archive or Project/docs"),
      }),
      execute: async ({ path }) => {
        const created = await createFolder(normalizeToolPath(path));
        await useVaultStore.getState().refreshTree();
        await yieldToUi();
        return { ok: true, path: created };
      },
    }),
    ensure_folder: tool({
      description:
        "Create a vault folder if it does not already exist (parents created as needed). Returns created=true when newly created, created=false when it already existed. Prefer this over create_folder when existence is enough.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Desired folder path, e.g. Ideas/Archive or Project/docs"),
      }),
      execute: async ({ path }) => {
        const target = normalizeToolPath(path).replace(/\/+$/, "");
        if (!target) {
          return { ok: false as const, error: "Folder path required" };
        }
        try {
          const result = await ensureFolder(target);
          if (result.created) {
            await useVaultStore.getState().refreshTree();
          }
          await yieldToUi();
          return {
            ok: true as const,
            path: result.path,
            created: result.created,
            existed: !result.created,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
    move_path: tool({
      description:
        "Move a vault file or folder into another folder while keeping its name. For Markdown notes, referenced files in the sibling .assets folder are migrated automatically and links are updated.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Vault-relative source path, e.g. Ideas/Draft.md"),
        to_folder: z
          .string()
          .describe(
            "Vault-relative destination folder, e.g. Archive/2026. Use an empty string for the vault root.",
          ),
      }),
      execute: async ({ path, to_folder: toFolder }) => {
        const from = normalizeToolPath(path).replace(/\/+$/, "");
        const destination = normalizeToolPath(toFolder).replace(/\/+$/, "");
        if (!from) {
          return { ok: false as const, error: "Source path required" };
        }

        const store = useVaultStore.getState();
        const moved = await store.moveTreeEntry(
          from,
          destination,
          Number.MAX_SAFE_INTEGER,
        );
        await yieldToUi();
        if (!moved) {
          return {
            ok: false as const,
            error:
              useVaultStore.getState().error ??
              `Could not move ${from} to ${destination || "vault root"}`,
          };
        }
        return {
          ok: true as const,
          from,
          path: moved,
        };
      },
    }),
    delete_path: tool({
      description:
        "Permanently delete a vault file or folder (folders delete recursively with all contents). Use only when the user clearly asks to delete/remove. Cannot delete the reserved Skills folder. Prefer delete_folder_if_empty when cleaning up a folder that should only go away if vacant.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Vault-relative path to delete, e.g. Ideas/Draft.md or Archive/old"),
      }),
      execute: async ({ path }) => {
        const target = normalizeToolPath(path).replace(/\/+$/, "");
        if (!target) {
          return { ok: false as const, error: "Path required" };
        }

        const ok = await useVaultStore.getState().removePath(target);
        await yieldToUi();
        if (!ok) {
          return {
            ok: false as const,
            error:
              useVaultStore.getState().error ?? `Could not delete ${target}`,
          };
        }
        return { ok: true as const, path: target };
      },
    }),
    delete_folder_if_empty: tool({
      description:
        "Delete a vault folder only if it is truly empty (no files or subfolders, including hidden .assets). Returns deleted=true when removed; otherwise deleted=false with reason not_found | not_a_folder | not_empty | protected.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Vault-relative folder path, e.g. Ideas/Archive"),
      }),
      execute: async ({ path }) => {
        const target = normalizeToolPath(path).replace(/\/+$/, "");
        if (!target) {
          return { ok: false as const, error: "Folder path required" };
        }
        try {
          const result = await deleteFolderIfEmpty(target);
          if (result.deleted) {
            const store = useVaultStore.getState();
            const { selectedFolderPath, expandedPaths } = store;
            if (
              selectedFolderPath === target ||
              selectedFolderPath.startsWith(`${target}/`)
            ) {
              useVaultStore.setState({
                selectedFolderPath: parentPath(target),
              });
            }
            const nextExpanded = expandedPaths.filter(
              (p) => p !== target && !p.startsWith(`${target}/`),
            );
            if (nextExpanded.length !== expandedPaths.length) {
              useVaultStore.setState({ expandedPaths: nextExpanded });
            }
            await store.refreshTree();
            void store.refreshVaultTags();
          }
          await yieldToUi();
          return {
            ok: true as const,
            path: result.path,
            deleted: result.deleted,
            reason: result.reason ?? null,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
    save_attachment: tool({
      description:
        "Save an image the user attached in chat into the note's sibling .assets/ folder. Returns a relative url like .assets/name.png — insert into markdown as ![alt](.assets/name.png) via edit_note (one blank line around the image).",
      inputSchema: z.object({
        note_path: z
          .string()
          .describe("Vault-relative note path that owns the .assets folder"),
        attachment_name: z
          .string()
          .optional()
          .describe("Filename of the chat attachment (preferred)"),
        attachment_index: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based index among user image attachments in this thread"),
        file_name: z
          .string()
          .optional()
          .describe("Optional destination filename inside .assets/"),
      }),
      execute: async ({
        note_path: notePath,
        attachment_name: attachmentName,
        attachment_index: attachmentIndex,
        file_name: fileName,
      }) => {
        const part = findAttachmentFilePart(getMessages(), {
          attachment_name: attachmentName,
          attachment_index: attachmentIndex,
        });
        if (!part) {
          return {
            ok: false as const,
            error:
              "No matching chat image attachment found. Ask the user to attach an image, or pass attachment_name / attachment_index.",
          };
        }
        if (!part.mediaType.startsWith("image/")) {
          return {
            ok: false as const,
            error: `Attachment is not an image (${part.mediaType})`,
          };
        }
        try {
          const bytes = dataUrlToBytes(part.url);
          if (bytes.byteLength > MAX_WRITE_ASSET_BYTES) {
            return {
              ok: false as const,
              error: `Attachment too large (max ${MAX_WRITE_ASSET_BYTES} bytes)`,
            };
          }
          const destName =
            fileName?.trim() || part.filename?.trim() || "image.png";
          const url = await writeAsset(notePath, destName, bytes);
          await yieldToUi();
          return {
            ok: true as const,
            note_path: notePath,
            url,
            markdown: `![${destName}](${url})`,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
    write_asset: tool({
      description:
        "Write raw image bytes (base64) into a note's sibling .assets/ folder. Prefer save_attachment for chat images. Returns .assets/… url for markdown ![alt](.assets/…).",
      inputSchema: z.object({
        note_path: z.string().describe("Vault-relative note path"),
        file_name: z.string().describe("Destination filename, e.g. shot.png"),
        data_base64: z
          .string()
          .min(1)
          .describe("Raw base64 image bytes (no data: URL prefix)"),
      }),
      execute: async ({
        note_path: notePath,
        file_name: fileName,
        data_base64: dataBase64,
      }) => {
        try {
          const cleaned = dataBase64.replace(/^data:[^;]+;base64,/, "");
          const bytes = base64ToBytes(cleaned);
          if (bytes.byteLength > MAX_WRITE_ASSET_BYTES) {
            return {
              ok: false as const,
              error: `Payload too large (max ${MAX_WRITE_ASSET_BYTES} bytes)`,
            };
          }
          const url = await writeAsset(notePath, fileName, bytes);
          await yieldToUi();
          return {
            ok: true as const,
            note_path: notePath,
            url,
            markdown: `![${fileName}](${url})`,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
  };
}

function syncOpenEditor(path: string, content: string) {
  const state = useVaultStore.getState();
  if (state.activePath !== path) return;
  // Defer editor remount so chat can paint the tool chip first.
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    latest.applyExternalContent(path, content);
    latest.markExternalWrite();
  }, 0);
}

export function buildSystemPrompt(opts: {
  mode: ChatMode;
  vaultPath: string | null;
  activePath: string | null;
  activeExcerpt: string | null;
  /** Selected vault project (first-level folder), if any. */
  projectPath?: string | null;
  /** Project "about" description from project properties. */
  projectAbout?: string | null;
  /** Project type from project properties (`""` | knowledgeBase | languageLearning | diary). */
  projectType?: string | null;
  /** Learning language ISO code when project type is language learning. */
  projectLearningLanguage?: string | null;
  /** Skill catalog (name + description) for model auto-discovery. */
  skills?: SkillMeta[] | null;
  /** Full skill bodies forced by the user via slash in the composer. */
  forcedSkills?: LoadedSkill[] | null;
  /** Tool names pinned by the user via @ chips in the composer. */
  forcedTools?: string[] | null;
}): string {
  const ai = useAiSettingsStore.getState().settings;
  const prefs = usePrefsStore.getState().prefs;
  const tavilyConfigured = Boolean(ai.tavilyApiKey.trim());
  const firecrawlConfigured = Boolean(ai.firecrawlApiKey.trim());

  const lines = [
    "You are MarkSpace, an AI assistant embedded in a local Markdown vault app.",
    "You mostly read and edit Markdown (.md) notes — plain text with Markdown formatting.",
    "You can also inspect and edit Draw.io diagrams (.drawio) via diagram tools. Prefer mutate_diagram for any multi-element change (add/update/color/align/connect/page settings/layout in one call). Also: read_diagram, create_diagram, and single-element helpers.",
    "You can manage link collections (.mdlnks) via links tools: read_links, add_link, update_link, remove_link, reorder_links, set_links_filter, create_links. Call read_mdlnks_format when unsure. Never raw-edit .mdlnks with edit_note/write_note.",
    "You can manage vocabulary dictionaries (.mddict) via dictionary tools: read_dictionary, add_entry, update_entry, remove_entry, reorder_entries, set_dictionary_filter, create_dictionary. Call read_mddict_format when unsure. Never raw-edit .mddict with edit_note/write_note. Dictionary tags are a separate bank from note/PDF tags and do not appear in the tag graph.",
    "PDF documents (.pdf) are first-class vault files (view-only). They appear in list_notes/list_folder, are indexed for search_notes and semantic_search when text is extractable, and open in the PDF viewer via open_note (optional page). Use read_note or read_file to get extracted text; scanned PDFs may have no text. Tags for PDFs are stored in vault filemeta (same catalog as notes / tag graph); never edit_note/write_note on PDFs.",
    ...mdlnksCoreRules().map((r) => `Links (.mdlnks): ${r}`),
    ...mddictCoreRules().map((r) => `Dictionary (.mddict): ${r}`),
    "You can search the public web (web_search) and fetch pages as markdown (fetch_url) when vault notes are not enough. fetch_url auto-picks Tavily (if configured) or Jina; x.com/twitter.com status URLs use FxTwitter automatically.",
    `Web API keys configured: Tavily=${tavilyConfigured ? "yes" : "no"}, Firecrawl=${firecrawlConfigured ? "yes" : "no"}. These flags are authoritative — never ask the user whether a key is set. If Firecrawl=yes and they ask for Firecrawl / provider=firecrawl / scrape_url, call the tool immediately. If Firecrawl=no and they insist on Firecrawl, tell them to add the key in Settings → Firecrawl API key.`,
    "scrape_url (Firecrawl browser scrape, markdown only) is expensive — ONLY call it when the user explicitly asks to scrape a page (or names Firecrawl / scrape_url). Never use it for routine fetch_url work.",
    "In Agent mode, use clip_article to save a web page as a vault note with images downloaded into .assets/ (prefer this over fetch_url + manual image saves when the user wants to keep the article). Default provider is Tavily/Jina; pass provider=firecrawl when the user wants Firecrawl for the clip.",
    "You can read vault files or download http(s) URLs with read_file (images are returned for vision analysis). In Agent mode, pass save_as to store a copy at a vault-relative path of your choice.",
    `Mode: ${opts.mode === "ask" ? "Ask (read-only tools only — do not attempt to modify notes)" : "Agent (you may read and write notes and folders via tools)"}.`,
    "Be concise. Prefer tools over guessing vault contents or the web.",
    "When several independent tool calls are needed (e.g. read different notes, list_folder + search_notes, web_search + read_note), issue them in the same step in parallel. Do not serialize independent reads. Never parallelize writes that touch the same path; for .drawio use one mutate_diagram, not many parallel updates.",
    "Vault search: prefer semantic_search for meaning/conceptual questions (paraphrases, topics); use search_notes for exact substrings, symbols, or filenames.",
    "Use list_tags to inspect the current vault tag catalog before choosing or changing note tags.",
    "For external facts/docs: web_search first, then fetch_url on the best 1–3 links. Do not invent URLs. To download an image/file into the vault, use read_file with save_as.",
    "When you need a decision, confirmation, or clarification with clear choices: use ask_user (multiple-choice + optional free-text) instead of listing A/B/C options in plain chat text. Keep questions focused; prefer one round of 1–3 questions.",
    "Paths are vault-relative. Use wiki-style note names only when resolving via tools.",
    "When the user mentions vault paths in their message (files or folders ending with /), use list_folder, read_note, and/or list_notes as needed — do not ask them to paste the contents again.",
    "Use list_folder to inspect folder contents (folders vs files; recursive optional). Prefer it over list_notes when checking whether a folder exists or listing empty folders.",
    "When the user asks to open, show, or switch to a note/diagram/PDF in the editor, call open_note (preview tab by default; for PDFs pass page from search hits). Prefer open_note to show work; still use read_note/get_active_note to read contents.",
    "MarkSpace Markdown is a dialect of standard Markdown. Follow these rules exactly; call read_format_guide when unsure or before writing non-trivial markdown:",
    ...markdownCoreRules(),
    "In chat replies you may include diagrams as fenced code blocks: ```mermaid for Mermaid, or ```plantuml / ```puml for PlantUML. The UI renders them inline. Prefer these for architecture/flow sketches in answers; use Draw.io tools only for .drawio vault files.",
  ];
  if (opts.mode === "agent") {
    lines.push(
      "When editing notes: prefer edit_note (partial replace) over write_note (full overwrite) to save tokens.",
      "Create empty folders with create_folder, or ensure_folder when you only need the path to exist (returns created vs already existed). To add a note in a new path, use create_note (parents are created automatically).",
      "Diary daily notes: always `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` with English month abbreviations (e.g. Journal/2026/08/02.Aug.2026.md). Use open_or_create_daily_note (date as YYYY-MM-DD) to create or open a day — never invent a different diary path with create_note.",
      "Move files or folders between vault folders with move_path. Markdown note assets referenced from .assets are migrated automatically.",
      "Delete files or folders with delete_path only when the user clearly asks to delete/remove them (folders are recursive). Use delete_folder_if_empty to remove a folder only if it is vacant.",
      "When reading long notes: use read_note/get_active_note with start_line and end_line instead of loading the whole file.",
      "Preserve existing Markdown structure; keep one empty line between paragraphs in any text you insert or rewrite.",
      "For .drawio files: use mutate_diagram for batch edits (never many parallel single updates — they race). Use temp_id on new nodes and reference them from add_edges / child parent in the same call. Never raw edit_note on XML.",
      "For .pdf files: use set_file_tags / get_file_tags for document tags (sidecar in .markspace/filemeta). Never edit_note/write_note on PDFs.",
      "For .mdlnks files: use add_link / update_link / remove_link / reorder_links / set_links_filter (never raw edit_note on the links text format).",
      "For .mddict files: use add_entry / update_entry / remove_entry / reorder_entries / set_dictionary_filter (never raw edit_note on the dictionary text format).",
      "Draw.io layout: for multi-shape diagrams OMIT x/y — mutate_diagram auto-layouts top-down (ArchiMate: Motivation→Strategy→Business→Application→Technology→Implementation). Do not invent sideways coordinates. Use layout:{type:'none'} only when intentionally keeping positions; layout:{type:'archimate'|'hierarchical'|'grid', direction:'top_down'|'left_right'} to override.",
      "Draw.io capabilities: text align/vertical_align/font_*; sketch; page_settings; shapes include group/swimlane and ArchiMate 3.2 (archimate.*); edges relation=serving|realization|assignment|…; parent=temp_id nesting; waypoints + exit_*/entry_*; add_pages/rename_pages.",
      "Images in notes: save with save_attachment (chat images), write_asset (raw base64 into note .assets/), read_file with save_as (URL/vault file → any vault path), or clip_article (web page → note + .assets/). Then edit_note to insert markdown using the returned path/url. Never invent .assets paths.",
      "When the user asks to clip/save/archive a web article into the vault, call clip_article then open_note on the returned path. Do not manually chain fetch_url + many read_file downloads for that workflow.",
      "When the user asks to translate a note (to their native language or another), call translate_note — it smart-translates in place (keeps frontmatter and #tags). Do not manually rewrite the whole note with write_note/edit_note for translation.",
    );
  }
  if (opts.vaultPath) {
    lines.push(`Open vault: ${opts.vaultPath}`);
  }
  const userName = prefs.userName.trim();
  if (userName) {
    lines.push(`The user's name is ${userName}.`);
    lines.push(
      `Address them as ${userName} in a warm, friendly tone (like a helpful colleague). Use their name naturally — greetings, check-ins, wrap-ups — but not in every short reply. Stay concise; do not be overly familiar or sycophantic.`,
    );
  }
  lines.push(
    `User's native language: ${nativeLanguageLabel(prefs.nativeLanguage)} (${prefs.nativeLanguage}). Prefer this language when the user writes in it or asks for a translation.`,
  );
  const catalogLines = formatSkillsCatalogLines(opts.skills ?? []);
  if (catalogLines.length > 0) {
    lines.push(...catalogLines);
  }
  const forcedLines = formatForcedSkillsLines(opts.forcedSkills ?? []);
  if (forcedLines.length > 0) {
    lines.push(...forcedLines);
  }
  const forcedToolLines = formatForcedToolsLines(opts.forcedTools ?? []);
  if (forcedToolLines.length > 0) {
    lines.push(...forcedToolLines);
  }
  if (opts.projectPath) {
    lines.push(`Active project: ${opts.projectPath}`);
    const typeLabel = projectTypeLabel(opts.projectType ?? "");
    if (typeLabel) {
      lines.push(`Project type: ${typeLabel}.`);
    }
    if (opts.projectType === "languageLearning") {
      const code = (opts.projectLearningLanguage ?? "").trim();
      if (code) {
        const label = isNativeLanguageId(code)
          ? nativeLanguageLabel(code)
          : code;
        lines.push(`Learning language: ${label} (${code}).`);
      } else {
        lines.push(
          "Learning language: not set (ask the user which language they are learning if needed).",
        );
      }
      lines.push(
        "For vocabulary / word lists in this project, prefer .mddict dictionary files and dictionary tools over Markdown tables.",
      );
    }
    if (opts.projectType === "diary") {
      lines.push(
        "This is a personal diary project. Prefer dated daily notes and keep entries personal and chronological unless the user asks otherwise.",
      );
      lines.push(
        "Daily notes live at `{project}/{yyyy}/{MM}/{dd.MMM.yyyy}.md` (e.g. Journal/2026/08/02.Aug.2026.md). In Agent mode call open_or_create_daily_note (optional date YYYY-MM-DD; omit for today) — do not hand-build paths with create_note.",
      );
    }
    const about = opts.projectAbout?.trim();
    if (about) {
      lines.push("Project description:");
      lines.push("```");
      lines.push(about.slice(0, 4000));
      lines.push("```");
    }
    lines.push(
      "Project scope: list_notes, list_folder (empty path = project root), search_notes, semantic_search, and list_tags are limited to this project. You may still read or edit files outside the project by explicit vault-relative path when needed (e.g. cross-project links or moves).",
    );
  }
  if (opts.activePath) {
    lines.push(`Active note: ${opts.activePath}`);
    if (opts.activeExcerpt) {
      lines.push("Active note excerpt:");
      lines.push("```");
      lines.push(opts.activeExcerpt.slice(0, 4000));
      lines.push("```");
    }
  } else {
    lines.push("No note is currently open.");
  }
  return lines.join("\n");
}

import { tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  createNote,
  listTree,
  readNote,
  searchNotes,
  writeAsset,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import {
  dataUrlToBytes,
  findAttachmentFilePart,
} from "./chatAttachments";
import { buildAskUserTool } from "./askUser";
import { buildDrawioTools } from "./drawio/tools";
import type { ChatMode } from "./types";
import { buildWebTools } from "./webTools";

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

export function buildVaultTools(
  mode: ChatMode,
  opts?: { getMessages?: () => UIMessage[] },
) {
  const getMessages = opts?.getMessages ?? (() => [] as UIMessage[]);

  const readTools = {
    list_notes: tool({
      description:
        "List vault-relative paths of markdown notes (and other files) in the open vault tree.",
      inputSchema: z.object({}),
      execute: async () => {
        const tree = await listTree();
        const paths = flattenPaths(tree).filter(
          (p) => p.endsWith(".md") || p.endsWith(".drawio"),
        );
        await yieldToUi();
        return { count: paths.length, paths: paths.slice(0, 500) };
      },
    }),

    search_notes: tool({
      description:
        "Search markdown note contents in the vault (case-insensitive substring). Returns path, line, snippet.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Search query"),
      }),
      execute: async ({ query }) => {
        const hits = await searchNotes(query);
        return { count: hits.length, hits };
      },
    }),

    read_note: tool({
      description:
        "Read a note by vault-relative path. Prefer start_line/end_line to read only a slice and save tokens; omit both to read the full file (capped).",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative path, e.g. Folder/Note.md"),
        start_line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based start line (inclusive)"),
        end_line: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("1-based end line (inclusive)"),
      }),
      execute: async ({ path, start_line: startLine, end_line: endLine }) => {
        const content = await readNote(path);
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
            path,
            start_line: start,
            end_line: end,
            line_count: lines.length,
            content: slice,
          };
        }
        const max = 80_000;
        if (content.length > max) {
          return {
            path,
            truncated: true,
            line_count: lines.length,
            content: content.slice(0, max),
          };
        }
        return {
          path,
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
  };

  const drawioTools = buildDrawioTools(mode);
  const webTools = buildWebTools();
  const askUserTool = { ask_user: buildAskUserTool() };

  if (mode === "ask") {
    return { ...readTools, ...drawioTools, ...webTools, ...askUserTool };
  }

  return {
    ...readTools,
    ...drawioTools,
    ...webTools,
    ...askUserTool,
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
        await writeNote(path, next);
        syncOpenEditor(path, next);
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
        await writeNote(path, content);
        syncOpenEditor(path, content);
        await yieldToUi();
        return { ok: true, path };
      },
    }),
    create_note: tool({
      description:
        "Create a new markdown note at a vault-relative path (adds .md if missing).",
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
}): string {
  const lines = [
    "You are MarkSpace, an AI assistant embedded in a local Markdown vault app.",
    "You mostly read and edit Markdown (.md) notes — plain text with Markdown formatting.",
    "You can also inspect and edit Draw.io diagrams (.drawio) via diagram tools. Prefer mutate_diagram for any multi-element change (add/update/color/align/connect/page settings/layout in one call). Also: read_diagram, create_diagram, and single-element helpers.",
    "You can search the public web (web_search) and fetch pages as markdown (fetch_url) when vault notes are not enough.",
    `Mode: ${opts.mode === "ask" ? "Ask (read-only tools only — do not attempt to modify notes)" : "Agent (you may read and write notes via tools)"}.`,
    "Be concise. Prefer tools over guessing vault contents or the web.",
    "For external facts/docs: web_search first, then fetch_url on the best 1–3 links. Do not invent URLs.",
    "When you need a decision, confirmation, or clarification with clear choices: use ask_user (multiple-choice + optional free-text) instead of listing A/B/C options in plain chat text. Keep questions focused; prefer one round of 1–3 questions.",
    "Paths are vault-relative. Use wiki-style note names only when resolving via tools.",
    "When the user mentions vault paths in their message (files or folders ending with /), use read_note and/or list_notes as needed — do not ask them to paste the contents again.",
    "When writing or editing Markdown: put exactly one blank line between paragraphs (and between a paragraph and a list/heading/code block). Do not collapse paragraphs into a single block and do not leave multiple consecutive blank lines.",
    "In chat replies you may include diagrams as fenced code blocks: ```mermaid for Mermaid, or ```plantuml / ```puml for PlantUML. The UI renders them inline. Prefer these for architecture/flow sketches in answers; use Draw.io tools only for .drawio vault files.",
  ];
  if (opts.mode === "agent") {
    lines.push(
      "When editing notes: prefer edit_note (partial replace) over write_note (full overwrite) to save tokens.",
      "When reading long notes: use read_note/get_active_note with start_line and end_line instead of loading the whole file.",
      "Preserve existing Markdown structure; keep one empty line between paragraphs in any text you insert or rewrite.",
      "For .drawio files: use mutate_diagram for batch edits (never many parallel single updates — they race). Use temp_id on new nodes and reference them from add_edges / child parent in the same call. Never raw edit_note on XML.",
      "Draw.io layout: for multi-shape diagrams OMIT x/y — mutate_diagram auto-layouts top-down (ArchiMate: Motivation→Strategy→Business→Application→Technology→Implementation). Do not invent sideways coordinates. Use layout:{type:'none'} only when intentionally keeping positions; layout:{type:'archimate'|'hierarchical'|'grid', direction:'top_down'|'left_right'} to override.",
      "Draw.io capabilities: text align/vertical_align/font_*; sketch; page_settings; shapes include group/swimlane and ArchiMate 3.2 (archimate.*); edges relation=serving|realization|assignment|…; parent=temp_id nesting; waypoints + exit_*/entry_*; add_pages/rename_pages.",
      "Images in notes: save with save_attachment (chat images) or write_asset (raw base64), then edit_note to insert ![alt](.assets/filename.ext) using the returned url. Put exactly one blank line before and after the image markdown. Never invent .assets paths.",
    );
  }
  if (opts.vaultPath) {
    lines.push(`Open vault: ${opts.vaultPath}`);
  }
  if (opts.projectPath) {
    lines.push(`Active project: ${opts.projectPath}`);
    const about = opts.projectAbout?.trim();
    if (about) {
      lines.push("Project description:");
      lines.push("```");
      lines.push(about.slice(0, 4000));
      lines.push("```");
    }
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

import { tool } from "ai";
import { z } from "zod";
import {
  createNote,
  listTree,
  readNote,
  searchNotes,
  writeNote,
  type TreeNode,
} from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import { buildDrawioTools } from "./drawio/tools";
import type { ChatMode } from "./types";
import { buildWebTools } from "./webTools";

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

export function buildVaultTools(mode: ChatMode) {
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

  if (mode === "ask") {
    return { ...readTools, ...drawioTools, ...webTools };
  }

  return {
    ...readTools,
    ...drawioTools,
    ...webTools,
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
  };
}

function syncOpenEditor(path: string, content: string) {
  const state = useVaultStore.getState();
  if (state.activePath !== path) return;
  // Defer editor remount so chat can paint the tool chip first.
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    useVaultStore.setState({ content, dirty: false });
    latest.markExternalWrite();
  }, 0);
}

export function buildSystemPrompt(opts: {
  mode: ChatMode;
  vaultPath: string | null;
  activePath: string | null;
  activeExcerpt: string | null;
}): string {
  const lines = [
    "You are MarkSpace, an AI assistant embedded in a local Markdown vault app.",
    "You mostly read and edit Markdown (.md) notes — plain text with Markdown formatting.",
    "You can also inspect and edit Draw.io diagrams (.drawio) via diagram tools. Prefer mutate_diagram for any multi-element change (add/update/color/connect in one call). Also: read_diagram, create_diagram, and single-element helpers.",
    "You can search the public web (web_search) and fetch pages as markdown (fetch_url) when vault notes are not enough.",
    `Mode: ${opts.mode === "ask" ? "Ask (read-only tools only — do not attempt to modify notes)" : "Agent (you may read and write notes via tools)"}.`,
    "Be concise. Prefer tools over guessing vault contents or the web.",
    "For external facts/docs: web_search first, then fetch_url on the best 1–3 links. Do not invent URLs.",
    "Paths are vault-relative. Use wiki-style note names only when resolving via tools.",
    "When writing or editing Markdown: put exactly one blank line between paragraphs (and between a paragraph and a list/heading/code block). Do not collapse paragraphs into a single block and do not leave multiple consecutive blank lines.",
  ];
  if (opts.mode === "agent") {
    lines.push(
      "When editing notes: prefer edit_note (partial replace) over write_note (full overwrite) to save tokens.",
      "When reading long notes: use read_note/get_active_note with start_line and end_line instead of loading the whole file.",
      "Preserve existing Markdown structure; keep one empty line between paragraphs in any text you insert or rewrite.",
      "For .drawio files: use mutate_diagram for batch edits (never many parallel single updates — they race). Use temp_id on new nodes and reference them from add_edges in the same call. Never raw edit_note on XML.",
    );
  }
  if (opts.vaultPath) {
    lines.push(`Open vault: ${opts.vaultPath}`);
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

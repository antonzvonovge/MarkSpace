import { tool } from "ai";
import { z } from "zod";
import {
  parseMdlnks,
  serializeMdlnks,
  type MdlnksDoc,
  type MdlnksItem,
} from "../../lib/mdlnksFormat";
import { createMdlnks, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { MDLNKS_FORMAT_GUIDE } from "../mdlnksFormat";

function assertMdlnksPath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".mdlnks")) {
    throw new Error(`Expected a .mdlnks path, got: ${path}`);
  }
  return p;
}

function syncOpenEditor(path: string, content: string) {
  const state = useVaultStore.getState();
  if (state.activePath !== path) return;
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    latest.applyExternalContent(path, content, { force: true });
    latest.markExternalWrite();
  }, 0);
}

async function loadDoc(path: string): Promise<{ path: string; doc: MdlnksDoc; raw: string }> {
  const p = assertMdlnksPath(path);
  const { activePath, content } = useVaultStore.getState();
  const raw = activePath === p && content != null ? content : await readNote(p);
  return { path: p, doc: parseMdlnks(raw), raw };
}

async function saveDoc(path: string, doc: MdlnksDoc) {
  const p = assertMdlnksPath(path);
  const text = serializeMdlnks(doc);
  await writeNote(p, text);
  syncOpenEditor(p, text);
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });
  return text;
}

function fail(path: string, e: unknown) {
  return {
    ok: false as const,
    error: e instanceof Error ? e.message : String(e),
    path,
  };
}

function findIndexByUrl(items: MdlnksItem[], url: string): number {
  const target = url.trim();
  return items.findIndex((item) => item.url === target);
}

export function buildMdlnksTools(mode: ChatMode) {
  const readTools = {
    read_mdlnks_format: tool({
      description:
        "Read the full MarkSpace .mdlnks links-file format guide. Call when unsure how to structure or edit a links collection.",
      inputSchema: z.object({}),
      execute: async () => ({ guide: MDLNKS_FORMAT_GUIDE }),
    }),

    read_links: tool({
      description:
        "Read a .mdlnks links file as structured items (url, description, tags) plus the persisted filter. Prefer this over read_note for links files.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdlnks path"),
      }),
      execute: async ({ path }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          return {
            ok: true as const,
            path: p,
            filter: doc.filter,
            count: doc.items.length,
            items: doc.items.map((item, index) => ({ index, ...item })),
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
  };

  if (mode === "ask") return readTools;

  return {
    ...readTools,

    create_links: tool({
      description:
        "Create a new empty .mdlnks links file in the vault (adds .mdlnks if missing).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Inbox/Reading.mdlnks"),
      }),
      execute: async ({ path }) => {
        try {
          const created = await createMdlnks(path);
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: created };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    add_link: tool({
      description: "Append a link entry to a .mdlnks file.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdlnks path"),
        url: z.string().min(1).describe("Link URL"),
        description: z.string().optional().describe("Short single-line description"),
        tags: z.array(z.string()).optional().describe("Tags without #"),
      }),
      execute: async ({ path, url, description, tags }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          doc.items.push({
            url: url.trim(),
            description: (description ?? "").trim(),
            tags: tags ?? [],
          });
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            index: doc.items.length - 1,
            count: doc.items.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    update_link: tool({
      description:
        "Update a link entry by index or exact URL. Provide fields to change; omitted fields stay unchanged.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional().describe("0-based item index"),
        url: z.string().optional().describe("Exact URL of the item to update"),
        new_url: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async ({ path, index, url, new_url, description, tags }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && url) i = findIndexByUrl(doc.items, url);
          if (i == null || i < 0 || i >= doc.items.length) {
            throw new Error("Link not found (provide index or exact url)");
          }
          const cur = doc.items[i]!;
          doc.items[i] = {
            url: (new_url ?? cur.url).trim(),
            description:
              description !== undefined ? description.trim() : cur.description,
            tags: tags !== undefined ? tags : cur.tags,
          };
          await saveDoc(p, doc);
          return { ok: true as const, path: p, index: i, item: doc.items[i] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    remove_link: tool({
      description: "Remove a link entry by index or exact URL.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional(),
        url: z.string().optional(),
      }),
      execute: async ({ path, index, url }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && url) i = findIndexByUrl(doc.items, url);
          if (i == null || i < 0 || i >= doc.items.length) {
            throw new Error("Link not found (provide index or exact url)");
          }
          const [removed] = doc.items.splice(i, 1);
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            removed,
            count: doc.items.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    reorder_links: tool({
      description:
        "Move a link entry to a new index (0-based). Identify the item by from_index or exact url.",
      inputSchema: z.object({
        path: z.string(),
        from_index: z.number().int().min(0).optional(),
        url: z.string().optional(),
        to_index: z.number().int().min(0).describe("Destination index after removal"),
      }),
      execute: async ({ path, from_index, url, to_index }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let from = from_index;
          if (from == null && url) from = findIndexByUrl(doc.items, url);
          if (from == null || from < 0 || from >= doc.items.length) {
            throw new Error("Link not found (provide from_index or exact url)");
          }
          const [moved] = doc.items.splice(from, 1);
          if (!moved) throw new Error("Link not found");
          const to = Math.max(0, Math.min(to_index, doc.items.length));
          doc.items.splice(to, 0, moved);
          await saveDoc(p, doc);
          return { ok: true as const, path: p, from, to, count: doc.items.length };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    set_links_filter: tool({
      description:
        "Set the persisted multi-tag filter on a .mdlnks file (AND semantics). Pass [] to clear.",
      inputSchema: z.object({
        path: z.string(),
        filter: z.array(z.string()).describe("Tags to require (AND); empty clears"),
      }),
      execute: async ({ path, filter }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          doc.filter = filter.map((t) => t.trim()).filter(Boolean);
          await saveDoc(p, doc);
          return { ok: true as const, path: p, filter: doc.filter };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
  };
}

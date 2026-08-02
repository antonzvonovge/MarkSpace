import { tool } from "ai";
import { z } from "zod";
import {
  parseMddict,
  serializeMddict,
  type MddictDoc,
  type MddictItem,
} from "../../lib/mddictFormat";
import { createMddict, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { MDDICT_FORMAT_GUIDE } from "../mddictFormat";

function assertMddictPath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".mddict")) {
    throw new Error(`Expected a .mddict path, got: ${path}`);
  }
  return p;
}

function syncOpenEditor(path: string, content: string) {
  const state = useVaultStore.getState();
  if (state.activePath !== path) return;
  window.setTimeout(() => {
    const latest = useVaultStore.getState();
    if (latest.activePath !== path) return;
    latest.applyExternalContent(path, content);
    latest.markExternalWrite();
  }, 0);
}

async function loadDoc(path: string): Promise<{ path: string; doc: MddictDoc; raw: string }> {
  const p = assertMddictPath(path);
  const { activePath, content } = useVaultStore.getState();
  const raw = activePath === p && content != null ? content : await readNote(p);
  return { path: p, doc: parseMddict(raw), raw };
}

async function saveDoc(path: string, doc: MddictDoc) {
  const p = assertMddictPath(path);
  const text = serializeMddict(doc);
  await writeNote(p, text);
  syncOpenEditor(p, text);
  void useVaultStore.getState().refreshDictionaryTags();
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

function findIndexByWord(items: MddictItem[], word: string): number {
  const target = word.trim().toLowerCase();
  return items.findIndex((item) => item.word.trim().toLowerCase() === target);
}

function normalizeExamples(examples: string[] | undefined): string[] | undefined {
  if (examples === undefined) return undefined;
  return examples.map((e) => e.trim()).filter(Boolean);
}

export function buildMddictTools(mode: ChatMode) {
  const readTools = {
    read_mddict_format: tool({
      description:
        "Read the full MarkSpace .mddict dictionary-file format guide. Call when unsure how to structure or edit a vocabulary dictionary.",
      inputSchema: z.object({}),
      execute: async () => ({ guide: MDDICT_FORMAT_GUIDE }),
    }),

    read_dictionary: tool({
      description:
        "Read a .mddict dictionary file as structured entries (word, transcript, translation, examples, tags) plus the persisted filter. Prefer this over read_note for dictionary files.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mddict path"),
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

    create_dictionary: tool({
      description:
        "Create a new empty .mddict dictionary file in the vault (adds .mddict if missing).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. German/Vocab.mddict"),
      }),
      execute: async ({ path }) => {
        try {
          const created = await createMddict(path);
          await useVaultStore.getState().refreshTree();
          void useVaultStore.getState().refreshDictionaryTags();
          return { ok: true as const, path: created };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    add_entry: tool({
      description: "Append a vocabulary entry to a .mddict file.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mddict path"),
        word: z.string().min(1).describe("Headword"),
        transcript: z.string().optional().describe("Pronunciation / IPA / etc."),
        translation: z.string().optional().describe("Translation / gloss"),
        examples: z.array(z.string()).optional().describe("Usage examples"),
        tags: z.array(z.string()).optional().describe("Tags without #"),
      }),
      execute: async ({ path, word, transcript, translation, examples, tags }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          doc.items.push({
            word: word.trim(),
            transcript: (transcript ?? "").trim(),
            translation: (translation ?? "").trim(),
            examples: normalizeExamples(examples) ?? [],
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

    update_entry: tool({
      description:
        "Update a dictionary entry by index or exact word. Provide fields to change; omitted fields stay unchanged.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional().describe("0-based item index"),
        word: z.string().optional().describe("Exact current word of the item to update"),
        new_word: z.string().optional(),
        transcript: z.string().optional(),
        translation: z.string().optional(),
        examples: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async ({
        path,
        index,
        word,
        new_word,
        transcript,
        translation,
        examples,
        tags,
      }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && word) i = findIndexByWord(doc.items, word);
          if (i == null || i < 0 || i >= doc.items.length) {
            throw new Error("Entry not found (provide index or exact word)");
          }
          const cur = doc.items[i]!;
          const nextWord = (new_word ?? cur.word).trim();
          if (!nextWord) throw new Error("word cannot be empty");
          doc.items[i] = {
            word: nextWord,
            transcript:
              transcript !== undefined ? transcript.trim() : cur.transcript,
            translation:
              translation !== undefined ? translation.trim() : cur.translation,
            examples:
              examples !== undefined
                ? (normalizeExamples(examples) ?? [])
                : cur.examples,
            tags: tags !== undefined ? tags : cur.tags,
          };
          await saveDoc(p, doc);
          return { ok: true as const, path: p, index: i, item: doc.items[i] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    remove_entry: tool({
      description: "Remove a dictionary entry by index or exact word.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional(),
        word: z.string().optional(),
      }),
      execute: async ({ path, index, word }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && word) i = findIndexByWord(doc.items, word);
          if (i == null || i < 0 || i >= doc.items.length) {
            throw new Error("Entry not found (provide index or exact word)");
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

    reorder_entries: tool({
      description:
        "Move a dictionary entry to a new index (0-based). Identify the item by from_index or exact word.",
      inputSchema: z.object({
        path: z.string(),
        from_index: z.number().int().min(0).optional(),
        word: z.string().optional(),
        to_index: z.number().int().min(0).describe("Destination index after removal"),
      }),
      execute: async ({ path, from_index, word, to_index }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let from = from_index;
          if (from == null && word) from = findIndexByWord(doc.items, word);
          if (from == null || from < 0 || from >= doc.items.length) {
            throw new Error("Entry not found (provide from_index or exact word)");
          }
          const [moved] = doc.items.splice(from, 1);
          if (!moved) throw new Error("Entry not found");
          const to = Math.max(0, Math.min(to_index, doc.items.length));
          doc.items.splice(to, 0, moved);
          await saveDoc(p, doc);
          return { ok: true as const, path: p, from, to, count: doc.items.length };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    set_dictionary_filter: tool({
      description:
        "Set the persisted multi-tag filter on a .mddict file (AND semantics). Pass [] to clear.",
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

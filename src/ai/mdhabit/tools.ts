import { tool } from "ai";
import { z } from "zod";
import {
  findHabitIndex,
  localIsoDate,
  parseMdhabit,
  serializeMdhabit,
  applyDayAnswers,
  type MdhabitDoc,
  type MdhabitItem,
} from "../../lib/mdhabitFormat";
import { normalizeProjectColor } from "../../lib/projectColors";
import { createMdhabit, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { MDHABIT_FORMAT_GUIDE } from "../mdhabitFormat";

function assertMdhabitPath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".mdhabit")) {
    throw new Error(`Expected a .mdhabit path, got: ${path}`);
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

async function loadDoc(path: string): Promise<{ path: string; doc: MdhabitDoc; raw: string }> {
  const p = assertMdhabitPath(path);
  const { activePath, content } = useVaultStore.getState();
  const raw = activePath === p && content != null ? content : await readNote(p);
  return { path: p, doc: parseMdhabit(raw), raw };
}

async function saveDoc(path: string, doc: MdhabitDoc) {
  const p = assertMdhabitPath(path);
  const text = serializeMdhabit(doc);
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

function requireHabit(habits: MdhabitItem[], name: string): number {
  const i = findHabitIndex(habits, name);
  if (i < 0) throw new Error(`Habit not found: ${name}`);
  return i;
}

export function buildMdhabitTools(mode: ChatMode) {
  const readTools = {
    read_mdhabit_format: tool({
      description:
        "Read the full MarkSpace .mdhabit habit-tracker format guide. Call when unsure how to structure or edit a yearly habit tracker.",
      inputSchema: z.object({}),
      execute: async () => ({ guide: MDHABIT_FORMAT_GUIDE }),
    }),

    read_habits: tool({
      description:
        "Read a .mdhabit tracker as year, created date, habits (name, question, color, Yes dates, No dates). Prefer this over read_note for habit files.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdhabit path"),
      }),
      execute: async ({ path }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          return {
            ok: true as const,
            path: p,
            year: doc.year,
            created: doc.created,
            count: doc.habits.length,
            habits: doc.habits.map((habit, index) => ({ index, ...habit })),
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

    create_habit_tracker: tool({
      description:
        "Create a new empty .mdhabit yearly habit tracker (adds .mdhabit if missing). Year defaults to the current local year.",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Health/2026.mdhabit"),
        year: z
          .number()
          .int()
          .min(1)
          .max(9999)
          .optional()
          .describe("Calendar year for the grid; defaults to the current year"),
      }),
      execute: async ({ path, year }) => {
        try {
          const y = year ?? new Date().getFullYear();
          const created = await createMdhabit(path, y, localIsoDate());
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: created, year: y };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    add_habit: tool({
      description: "Append a habit (name, question, optional project-palette color) to a .mdhabit file.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdhabit path"),
        name: z.string().min(1).describe("Short habit name, unique in the file"),
        question: z.string().min(1).describe("Checkbox question shown in the day dialog"),
        color: z
          .string()
          .optional()
          .describe("Optional project color hex, e.g. #2196f3"),
      }),
      execute: async ({ path, name, question, color }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          if (findHabitIndex(doc.habits, name) >= 0) {
            throw new Error(`Habit already exists: ${name}`);
          }
          doc.habits.push({
            name: name.trim(),
            question: question.trim(),
            color: normalizeProjectColor(color ?? ""),
            dates: [],
            no: [],
          });
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            index: doc.habits.length - 1,
            count: doc.habits.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    update_habit: tool({
      description:
        "Update a habit by index or name. Provide fields to change; omitted fields stay unchanged.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional().describe("0-based habit index"),
        name: z.string().optional().describe("Current habit name"),
        new_name: z.string().optional(),
        question: z.string().optional(),
        color: z.string().optional().describe("Project color hex, or empty to clear"),
      }),
      execute: async ({ path, index, name, new_name, question, color }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && name) i = findHabitIndex(doc.habits, name);
          if (i == null || i < 0 || i >= doc.habits.length) {
            throw new Error("Habit not found (provide index or name)");
          }
          const cur = doc.habits[i]!;
          const nextName = (new_name ?? cur.name).trim();
          if (
            nextName.toLowerCase() !== cur.name.toLowerCase() &&
            findHabitIndex(doc.habits, nextName) >= 0
          ) {
            throw new Error(`Habit already exists: ${nextName}`);
          }
          doc.habits[i] = {
            ...cur,
            name: nextName,
            question:
              question !== undefined ? question.trim() : cur.question,
            color:
              color !== undefined ? normalizeProjectColor(color) : cur.color,
          };
          await saveDoc(p, doc);
          return { ok: true as const, path: p, index: i, habit: doc.habits[i] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    remove_habit: tool({
      description: "Remove a habit by index or name, including all of its logged days.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional(),
        name: z.string().optional(),
      }),
      execute: async ({ path, index, name }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && name) i = findHabitIndex(doc.habits, name);
          if (i == null || i < 0 || i >= doc.habits.length) {
            throw new Error("Habit not found (provide index or name)");
          }
          const [removed] = doc.habits.splice(i, 1);
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            removed,
            count: doc.habits.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    set_habit_day: tool({
      description:
        "Set explicit Yes/No answers for habits on a local calendar day (YYYY-MM-DD). `checked` are Yes, `no` are No. Habits listed in neither are left unanswered (skip). Yes and No are stored separately.",
      inputSchema: z.object({
        path: z.string(),
        date: z.string().describe("Local calendar day YYYY-MM-DD"),
        checked: z
          .array(z.string())
          .describe("Habit names answered Yes this day"),
        no: z
          .array(z.string())
          .optional()
          .describe("Habit names answered No this day"),
      }),
      execute: async ({ path, date, checked, no }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          for (const n of checked) requireHabit(doc.habits, n);
          for (const n of no ?? []) requireHabit(doc.habits, n);
          doc.habits = applyDayAnswers(doc.habits, date, checked, no ?? []);
          await saveDoc(p, doc);
          return { ok: true as const, path: p, date, checked, no: no ?? [] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
  };
}

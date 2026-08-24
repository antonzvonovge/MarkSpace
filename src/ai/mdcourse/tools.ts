import { tool } from "ai";
import { z } from "zod";
import {
  applyTrackDay,
  findTrackIndex,
  localIsoDate,
  parseClockTimes,
  parseMdcourse,
  parseWeekdays,
  serializeMdcourse,
  type MdcourseDoc,
  type MdcourseTrack,
} from "../../lib/mdcourseFormat";
import { normalizeProjectColor } from "../../lib/projectColors";
import { createMdcourse, readNote, writeNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { ChatMode } from "../types";
import { MDCOURSE_FORMAT_GUIDE } from "../mdcourseFormat";

function assertMdcoursePath(path: string): string {
  const p = path.trim();
  if (!p.toLowerCase().endsWith(".mdcourse")) {
    throw new Error(`Expected a .mdcourse path, got: ${path}`);
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

async function loadDoc(path: string): Promise<{ path: string; doc: MdcourseDoc; raw: string }> {
  const p = assertMdcoursePath(path);
  const { activePath, content } = useVaultStore.getState();
  const raw = activePath === p && content != null ? content : await readNote(p);
  return { path: p, doc: parseMdcourse(raw), raw };
}

async function saveDoc(path: string, doc: MdcourseDoc) {
  const p = assertMdcoursePath(path);
  const text = serializeMdcourse(doc);
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

function requireTrack(tracks: MdcourseTrack[], name: string): number {
  const i = findTrackIndex(tracks, name);
  if (i < 0) throw new Error(`Track not found: ${name}`);
  return i;
}

export function buildMdcourseTools(mode: ChatMode) {
  const readTools = {
    read_mdcourse_format: tool({
      description:
        "Read the full MarkSpace .mdcourse course-tracker format guide. Call when unsure how to structure or edit a course.",
      inputSchema: z.object({}),
      execute: async () => ({ guide: MDCOURSE_FORMAT_GUIDE }),
    }),

    read_course: tool({
      description:
        "Read a .mdcourse tracker as created date and tracks (name, question, when, time, weekdays, times, start, days/ongoing, log). Prefer this over read_note for course files.",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdcourse path"),
      }),
      execute: async ({ path }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          return {
            ok: true as const,
            path: p,
            created: doc.created,
            count: doc.tracks.length,
            tracks: doc.tracks.map((track, index) => ({ index, ...track })),
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

    create_course: tool({
      description:
        "Create a new empty .mdcourse course tracker (adds .mdcourse if missing).",
      inputSchema: z.object({
        path: z.string().describe("Desired path, e.g. Health/Skin.mdcourse"),
      }),
      execute: async ({ path }) => {
        try {
          const created = await createMdcourse(path, localIsoDate());
          await useVaultStore.getState().refreshTree();
          return { ok: true as const, path: created };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    add_course_track: tool({
      description:
        "Append a track to a .mdcourse file. Provide days or ongoing (not both). Optional weekdays (Mon–Sun or 1–7, Monday=1) and time (HH:MM clocks).",
      inputSchema: z.object({
        path: z.string().describe("Vault-relative .mdcourse path"),
        name: z.string().min(1).describe("Short track name, unique in the file"),
        question: z.string().min(1).describe("Day quiz prompt"),
        when: z.string().optional().describe("Free-text hint, not a clock"),
        time: z
          .string()
          .optional()
          .describe("Optional 24-hour clocks, space-separated, e.g. 08:00 20:00"),
        weekdays: z
          .string()
          .optional()
          .describe("Optional weekdays, e.g. Mon Wed Fri or 1 3 5. Omit = every day"),
        color: z.string().optional().describe("Optional project color hex"),
        start: z.string().describe("Start day YYYY-MM-DD"),
        days: z.number().int().min(1).optional(),
        ongoing: z.boolean().optional(),
        times: z.number().int().min(1).max(8).optional(),
      }),
      execute: async ({
        path,
        name,
        question,
        when,
        time,
        weekdays,
        color,
        start,
        days,
        ongoing,
        times,
      }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          if (findTrackIndex(doc.tracks, name) >= 0) {
            throw new Error(`Track already exists: ${name}`);
          }
          const isOngoing = ongoing === true;
          if (isOngoing && days != null) {
            throw new Error("Provide days or ongoing, not both");
          }
          if (!isOngoing && days == null) {
            throw new Error("Provide days or ongoing: true");
          }
          doc.tracks.push({
            name: name.trim(),
            question: question.trim(),
            when: (when ?? "").trim(),
            time: parseClockTimes(time ?? ""),
            weekdays: parseWeekdays(weekdays ?? ""),
            color: normalizeProjectColor(color ?? ""),
            start,
            days: isOngoing ? null : days!,
            ongoing: isOngoing,
            times: times ?? 1,
            log: {},
          });
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            index: doc.tracks.length - 1,
            count: doc.tracks.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    update_course_track: tool({
      description:
        "Update a course track by index or name. Provide fields to change; omitted fields stay unchanged.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional(),
        name: z.string().optional().describe("Current track name"),
        new_name: z.string().optional(),
        question: z.string().optional(),
        when: z.string().optional().describe("Free-text hint; not a clock"),
        time: z
          .string()
          .nullable()
          .optional()
          .describe("24-hour clocks, space-separated; empty or null clears"),
        weekdays: z
          .string()
          .nullable()
          .optional()
          .describe("Mon…Sun or 1–7; empty/null/all = every day"),
        color: z.string().optional(),
        start: z.string().optional(),
        days: z.number().int().min(1).nullable().optional(),
        ongoing: z.boolean().optional(),
        times: z.number().int().min(1).max(8).optional(),
      }),
      execute: async ({
        path,
        index,
        name,
        new_name,
        question,
        when,
        time,
        weekdays,
        color,
        start,
        days,
        ongoing,
        times,
      }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && name) i = findTrackIndex(doc.tracks, name);
          if (i == null || i < 0 || i >= doc.tracks.length) {
            throw new Error("Track not found (provide index or name)");
          }
          const cur = doc.tracks[i]!;
          const nextName = (new_name ?? cur.name).trim();
          if (
            nextName.toLowerCase() !== cur.name.toLowerCase() &&
            findTrackIndex(doc.tracks, nextName) >= 0
          ) {
            throw new Error(`Track already exists: ${nextName}`);
          }
          let nextOngoing = ongoing ?? cur.ongoing;
          let nextDays = days === undefined ? cur.days : days;
          if (nextOngoing) nextDays = null;
          else if (nextDays == null) {
            throw new Error("Finite tracks need days");
          }
          doc.tracks[i] = {
            ...cur,
            name: nextName,
            question: question !== undefined ? question.trim() : cur.question,
            when: when !== undefined ? when.trim() : cur.when,
            time:
              time === undefined
                ? cur.time
                : parseClockTimes(time ?? ""),
            weekdays:
              weekdays === undefined
                ? cur.weekdays
                : parseWeekdays(weekdays ?? ""),
            color: color !== undefined ? normalizeProjectColor(color) : cur.color,
            start: start ?? cur.start,
            days: nextDays,
            ongoing: nextOngoing,
            times: times ?? cur.times,
          };
          await saveDoc(p, doc);
          return { ok: true as const, path: p, index: i, track: doc.tracks[i] };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    remove_course_track: tool({
      description: "Remove a course track by index or name, including its log.",
      inputSchema: z.object({
        path: z.string(),
        index: z.number().int().min(0).optional(),
        name: z.string().optional(),
      }),
      execute: async ({ path, index, name }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          let i = index;
          if (i == null && name) i = findTrackIndex(doc.tracks, name);
          if (i == null || i < 0 || i >= doc.tracks.length) {
            throw new Error("Track not found (provide index or name)");
          }
          const [removed] = doc.tracks.splice(i, 1);
          await saveDoc(p, doc);
          return {
            ok: true as const,
            path: p,
            removed,
            count: doc.tracks.length,
          };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),

    set_course_day: tool({
      description:
        "Set log counts for named tracks on a local calendar day. Keys are track names (case-insensitive); values are 0…times. Unlisted tracks are left unchanged.",
      inputSchema: z.object({
        path: z.string(),
        date: z.string().describe("Local calendar day YYYY-MM-DD"),
        answers: z
          .record(z.string(), z.number().int().min(0).max(8))
          .describe("Track name → count"),
      }),
      execute: async ({ path, date, answers }) => {
        try {
          const { path: p, doc } = await loadDoc(path);
          const keyed: Record<string, number> = {};
          for (const [n, k] of Object.entries(answers)) {
            requireTrack(doc.tracks, n);
            keyed[n.trim().toLowerCase()] = k;
          }
          doc.tracks = applyTrackDay(doc.tracks, date, keyed);
          await saveDoc(p, doc);
          return { ok: true as const, path: p, date, answers };
        } catch (e) {
          return fail(path, e);
        }
      },
    }),
  };
}

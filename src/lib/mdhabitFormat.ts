/** On-disk format for MarkSpace `.mdhabit` yearly habit-tracker files. */

import { normalizeProjectColor } from "./projectColors";

export const MDHABIT_HEADER = "# MarkSpace habits v1";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const META_KEYS = /^(question|color|year|created|logged|dates|no):/i;

export type MdhabitItem = {
  name: string;
  question: string;
  /** Whitelist project color hex, or "" if unset. */
  color: string;
  /** Explicit Yes days `YYYY-MM-DD`, sorted unique. */
  dates: string[];
  /** Explicit No days `YYYY-MM-DD`, sorted unique. */
  no: string[];
};

export type MdhabitDoc = {
  year: number;
  /** Local calendar day the file was created (`YYYY-MM-DD`). */
  created: string;
  habits: MdhabitItem[];
};

export type HabitAnswer = "yes" | "no" | "none";

export function emptyMdhabit(year: number, created: string): string {
  return serializeMdhabit({
    year,
    created: normalizeIsoDate(created) ?? localIsoDate(),
    habits: [],
  });
}

export const EMPTY_MDHABIT = emptyMdhabit(2026, "2026-01-01");

function isMetaKey(line: string): boolean {
  return META_KEYS.test(line);
}

/** Local calendar `YYYY-MM-DD` (not UTC). */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function normalizeIsoDate(raw: string): string | null {
  const m = ISO_DAY.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseIsoTokens(raw: string, label: string, lineNo: number): string[] {
  const out: string[] = [];
  for (const part of raw.trim().split(/[\s,]+/).filter(Boolean)) {
    const iso = normalizeIsoDate(part);
    if (!iso) {
      throw new Error(`Invalid ${label} date at line ${lineNo}: ${part}`);
    }
    out.push(iso);
  }
  return out;
}

function parseYear(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return null;
  return n;
}

function sortUniqueDates(dates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of dates) {
    const iso = normalizeIsoDate(raw);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  out.sort();
  return out;
}

function habitNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Parse a `.mdhabit` document. Throws on invalid header or structure. */
export function parseMdhabit(text: string): MdhabitDoc {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (first !== MDHABIT_HEADER) {
    throw new Error(`Invalid .mdhabit header (expected "${MDHABIT_HEADER}")`);
  }

  let i = 1;
  let year: number | null = null;
  let created: string | null = null;
  const logged: string[] = [];

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;
    const line = lines[i].trim();
    const yearM = /^year:\s*(.*)$/i.exec(line);
    if (yearM) {
      year = parseYear(yearM[1] ?? "");
      if (year == null) {
        throw new Error(`Invalid year at line ${i + 1}: ${line}`);
      }
      i += 1;
      continue;
    }
    const createdM = /^created:\s*(.*)$/i.exec(line);
    if (createdM) {
      created = normalizeIsoDate(createdM[1] ?? "");
      if (!created) {
        throw new Error(`Invalid created date at line ${i + 1}: ${line}`);
      }
      i += 1;
      continue;
    }
    const loggedM = /^logged:\s*(.*)$/i.exec(line);
    if (loggedM) {
      logged.push(...parseIsoTokens(loggedM[1] ?? "", "logged", i + 1));
      i += 1;
      continue;
    }
    break;
  }

  if (year == null) {
    throw new Error("Missing year: in .mdhabit header");
  }
  if (!created) {
    throw new Error("Missing created: in .mdhabit header");
  }

  const habits: MdhabitItem[] = [];
  const seenNames = new Set<string>();

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;

    const nameLine = lines[i].trim();
    if (!nameLine || isMetaKey(nameLine) || ISO_DAY.test(nameLine)) {
      throw new Error(
        `Expected habit name at line ${i + 1}, got: ${nameLine || "(empty)"}`,
      );
    }
    i += 1;

    const key = habitNameKey(nameLine);
    if (seenNames.has(key)) {
      throw new Error(`Duplicate habit name: ${nameLine}`);
    }
    seenNames.add(key);

    let question = "";
    let color = "";
    const dates: string[] = [];
    const nos: string[] = [];

    while (i < lines.length && lines[i].trim() !== "") {
      const line = lines[i].trim();
      const q = /^question:\s*(.*)$/i.exec(line);
      if (q) {
        question = (q[1] ?? "").trim();
        i += 1;
        continue;
      }
      const c = /^color:\s*(.*)$/i.exec(line);
      if (c) {
        color = normalizeProjectColor(c[1] ?? "");
        i += 1;
        continue;
      }
      const datesM = /^dates:\s*(.*)$/i.exec(line);
      if (datesM) {
        dates.push(...parseIsoTokens(datesM[1] ?? "", "dates", i + 1));
        i += 1;
        continue;
      }
      const noM = /^no:\s*(.*)$/i.exec(line);
      if (noM) {
        nos.push(...parseIsoTokens(noM[1] ?? "", "no", i + 1));
        i += 1;
        continue;
      }
      const iso = normalizeIsoDate(line);
      if (iso) {
        dates.push(iso);
        i += 1;
        continue;
      }
      throw new Error(`Unexpected line in habit entry at ${i + 1}: ${line}`);
    }

    const yes = sortUniqueDates(dates);
    const yesSet = new Set(yes);
    habits.push({
      name: nameLine,
      question,
      color,
      dates: yes,
      no: sortUniqueDates(nos).filter((iso) => !yesSet.has(iso)),
    });
  }

  for (const iso of sortUniqueDates(logged)) {
    for (const habit of habits) {
      if (habit.dates.includes(iso) || habit.no.includes(iso)) continue;
      habit.no = sortUniqueDates([...habit.no, iso]);
    }
  }

  return { year, created, habits };
}

/** Serialize a habits document. Always ends with a trailing newline. */
export function serializeMdhabit(doc: MdhabitDoc): string {
  const parts: string[] = [
    MDHABIT_HEADER,
    `year: ${doc.year}`,
    `created: ${doc.created}`,
    "",
  ];

  for (const habit of doc.habits) {
    parts.push(habit.name.trim());
    parts.push(`question: ${habit.question.trim()}`);
    const color = normalizeProjectColor(habit.color);
    if (color) parts.push(`color: ${color}`);
    const yes = sortUniqueDates(habit.dates);
    const no = sortUniqueDates(habit.no ?? []).filter((iso) => !yes.includes(iso));
    if (yes.length > 0) parts.push(`dates: ${yes.join(" ")}`);
    if (no.length > 0) parts.push(`no: ${no.join(" ")}`);
    parts.push("");
  }

  return parts.join("\n");
}

export function findHabitIndex(habits: MdhabitItem[], name: string): number {
  const key = habitNameKey(name);
  return habits.findIndex((h) => habitNameKey(h.name) === key);
}

export function habitAnswerOnDay(habit: MdhabitItem, iso: string): HabitAnswer {
  if (habit.dates.includes(iso)) return "yes";
  if ((habit.no ?? []).includes(iso)) return "no";
  return "none";
}

/** Yes count and yes+no count on `iso`. Unanswered habits are omitted from `answered`. */
export function dayAnswerCounts(
  habits: MdhabitItem[],
  iso: string,
): { done: number; answered: number } {
  let done = 0;
  let answered = 0;
  for (const habit of habits) {
    const a = habitAnswerOnDay(habit, iso);
    if (a === "none") continue;
    answered += 1;
    if (a === "yes") done += 1;
  }
  return { done, answered };
}

export function checkedCountOnDay(habits: MdhabitItem[], iso: string): number {
  return dayAnswerCounts(habits, iso).done;
}

export function dayHasAnswers(habits: MdhabitItem[], iso: string): boolean {
  return habits.some((h) => habitAnswerOnDay(h, iso) !== "none");
}

export function dayIsLogged(doc: MdhabitDoc, iso: string): boolean {
  return dayHasAnswers(doc.habits, iso);
}

function withDate(list: string[], iso: string, on: boolean): string[] {
  if (on) return sortUniqueDates([...(list ?? []), iso]);
  return (list ?? []).filter((d) => d !== iso);
}

/** Apply explicit Yes/No for some habits; unlisted habits stay unanswered (skip). */
export function applyDayAnswers(
  habits: MdhabitItem[],
  iso: string,
  yesNames: string[],
  noNames: string[],
): MdhabitItem[] {
  const date = normalizeIsoDate(iso);
  if (!date) throw new Error(`Invalid date: ${iso}`);
  const yes = new Set(yesNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const no = new Set(noNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return habits.map((habit) => {
    const key = habit.name.trim().toLowerCase();
    if (yes.has(key)) {
      return {
        ...habit,
        dates: withDate(habit.dates, date, true),
        no: withDate(habit.no, date, false),
      };
    }
    if (no.has(key)) {
      return {
        ...habit,
        dates: withDate(habit.dates, date, false),
        no: withDate(habit.no, date, true),
      };
    }
    return habit;
  });
}

export function setHabitDay(
  habits: MdhabitItem[],
  name: string,
  iso: string,
  checked: boolean,
): MdhabitItem[] {
  if (findHabitIndex(habits, name) < 0) throw new Error(`Habit not found: ${name}`);
  if (checked) return applyDayAnswers(habits, iso, [name], []);
  return applyDayAnswers(habits, iso, [], [name]);
}

export type HabitDayPaint = "none" | "gray" | "ratio";

/**
 * Whether / how to paint a calendar cell.
 * `total` is the number of explicit answers (yes+no), not all habits.
 * Unanswered days stay empty (including today); only explicit No paints red.
 */
export function habitDayPaint(
  iso: string,
  created: string,
  _today: string,
  _done: number,
  total: number,
): HabitDayPaint {
  if (total <= 0) return iso < created ? "gray" : "none";
  return "ratio";
}

/** Mix missed (red) → done (green) by `done/total` in [0, 1]. */
export function habitRatioColor(
  done: number,
  total: number,
  missedHex = "#ff4d6d",
  doneHex = "#22c55e",
): string {
  if (total <= 0) return "transparent";
  const t = Math.min(1, Math.max(0, done / total));
  const a = hexToRgb(missedHex);
  const b = hexToRgb(doneHex);
  if (!a || !b) return doneHex;
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bch = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

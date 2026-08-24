/** On-disk format for MarkSpace `.mdcourse` course-tracker files. */

import { normalizeProjectColor } from "./projectColors";
import { localIsoDate, normalizeIsoDate } from "./mdhabitFormat";

export { localIsoDate, normalizeIsoDate };

export const MDCOURSE_HEADER = "# MarkSpace course v1";

const META_KEYS =
  /^(question|color|when|time|weekdays|times|start|days|ongoing|log|created):/i;

/** ISO weekday: Monday = 1 … Sunday = 7. */
export const COURSE_WEEKDAY_CODES = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const COURSE_WEEKDAY_SHORT = [
  "Mo",
  "Tu",
  "We",
  "Th",
  "Fr",
  "Sa",
  "Su",
] as const;

export const COURSE_TIMES_MIN = 1;
export const COURSE_TIMES_MAX = 8;
export const COURSE_ONGOING_PAD_DAYS = 7;

export type MdcourseLog = Record<string, number>;

export type MdcourseTrack = {
  name: string;
  question: string;
  when: string;
  /** Clock times `HH:MM`, in segment order. Empty = none. */
  time: string[];
  /** ISO weekdays 1–7. Empty = every day in the window. */
  weekdays: number[];
  color: string;
  start: string;
  /** Finite length in days; null when `ongoing`. */
  days: number | null;
  ongoing: boolean;
  times: number;
  /** Day → count in `0…times`. Missing day = skip. */
  log: MdcourseLog;
};

export type MdcourseDoc = {
  created: string;
  tracks: MdcourseTrack[];
};

export type CourseSegmentKind =
  | "out"
  | "plan"
  | "unmarked"
  | "missed"
  | "done";

function isMetaKey(line: string): boolean {
  return META_KEYS.test(line);
}

function trackNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function addIsoDays(iso: string, delta: number): string {
  const n = normalizeIsoDate(iso);
  if (!n) throw new Error(`Invalid date: ${iso}`);
  const [y, m, d] = n.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + delta);
  return localIsoDate(dt);
}

export function daysBetweenInclusive(start: string, end: string): number {
  const a = normalizeIsoDate(start);
  const b = normalizeIsoDate(end);
  if (!a || !b) return 0;
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  const t1 = Date.UTC(y1!, m1! - 1, d1!);
  const t2 = Date.UTC(y2!, m2! - 1, d2!);
  return Math.floor((t2 - t1) / 86400000) + 1;
}

/** Last day of a finite track (`start + days - 1`). */
export function trackEnd(track: MdcourseTrack): string | null {
  if (track.ongoing || track.days == null) return null;
  return addIsoDays(track.start, track.days - 1);
}

export function isoWeekday(iso: string): number | null {
  const n = normalizeIsoDate(iso);
  if (!n) return null;
  const [y, m, d] = n.split("-").map(Number);
  const js = new Date(y!, m! - 1, d!).getDay();
  return js === 0 ? 7 : js;
}

export function normalizeWeekdays(days: number[]): number[] {
  const uniq = new Set<number>();
  for (const d of days) {
    if (!Number.isInteger(d) || d < 1 || d > 7) continue;
    uniq.add(d);
  }
  return [...uniq].sort((a, b) => a - b);
}

/** Empty list means every weekday. */
export function weekdaysActiveOn(weekdays: number[], iso: string): boolean {
  if (weekdays.length === 0) return true;
  const dow = isoWeekday(iso);
  return dow != null && weekdays.includes(dow);
}

const WEEKDAY_ALIAS: Record<string, number> = {
  mon: 1,
  monday: 1,
  mo: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  tu: 2,
  wed: 3,
  wednesday: 3,
  we: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  th: 4,
  fri: 5,
  friday: 5,
  fr: 5,
  sat: 6,
  saturday: 6,
  sa: 6,
  sun: 7,
  sunday: 7,
  su: 7,
};

export function parseWeekdays(raw: string, lineNo?: number): number[] {
  const text = raw.trim();
  if (!text || /^all$/i.test(text) || /^every(day)?$/i.test(text)) return [];
  const out: number[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const n = Number.parseInt(part, 10);
    if (Number.isInteger(n) && String(n) === part && n >= 1 && n <= 7) {
      out.push(n);
      continue;
    }
    const code = WEEKDAY_ALIAS[part.toLowerCase()];
    if (code == null) {
      const where = lineNo != null ? ` at line ${lineNo}` : "";
      throw new Error(`Invalid weekday${where}: ${part}`);
    }
    out.push(code);
  }
  return normalizeWeekdays(out);
}

export function serializeWeekdays(weekdays: number[]): string | null {
  const days = normalizeWeekdays(weekdays);
  if (days.length === 0 || days.length === 7) return null;
  return days.map((d) => COURSE_WEEKDAY_CODES[d - 1]).join(" ");
}

export function parseClockTimes(raw: string, lineNo?: number): string[] {
  const text = raw.trim();
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.split(/[\s,]+/).filter((p) => p.length > 0)) {
    if (part === "-") {
      out.push("");
      continue;
    }
    const m = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!m) {
      const where = lineNo != null ? ` at line ${lineNo}` : "";
      throw new Error(`Invalid time${where}: ${part}`);
    }
    const h = Number.parseInt(m[1]!, 10);
    const min = Number.parseInt(m[2]!, 10);
    if (h > 23 || min > 59) {
      const where = lineNo != null ? ` at line ${lineNo}` : "";
      throw new Error(`Invalid time${where}: ${part}`);
    }
    out.push(`${String(h).padStart(2, "0")}:${m[2]}`);
  }
  if (out.length > COURSE_TIMES_MAX) {
    throw new Error(
      `Too many times${lineNo != null ? ` at line ${lineNo}` : ""}`,
    );
  }
  return out;
}

export function padSegmentTimes(time: string[], times: number): string[] {
  const n = clampTimes(times);
  return Array.from({ length: n }, (_, i) => time[i] ?? "");
}

export function serializeClockTimes(
  time: string[],
  times: number,
): string | null {
  const cells = padSegmentTimes(time, times).map((cell) => {
    const t = cell.trim();
    if (!t || t === "-") return "-";
    return parseClockTimes(t)[0] ?? "-";
  });
  if (cells.every((c) => c === "-")) return null;
  return cells.join(" ");
}

export function formatTrackSchedule(track: MdcourseTrack): string {
  const parts: string[] = [];
  const days = normalizeWeekdays(track.weekdays);
  if (days.length > 0 && days.length < 7) {
    parts.push(days.map((d) => COURSE_WEEKDAY_SHORT[d - 1]).join(" "));
  }
  if (track.time.length > 0) parts.push(track.time.join(" "));
  else if (track.when.trim()) parts.push(track.when.trim());
  return parts.join(" · ");
}

export function trackActiveOnDay(track: MdcourseTrack, iso: string): boolean {
  if (iso < track.start) return false;
  if (!track.ongoing) {
    const end = trackEnd(track);
    if (end == null || iso > end) return false;
  }
  return weekdaysActiveOn(track.weekdays, iso);
}

export function trackDurationRank(track: MdcourseTrack): number {
  if (track.ongoing) return Number.POSITIVE_INFINITY;
  return track.days ?? 0;
}

/** Bar order: longest at the bottom (last). Ties keep file order. */
export function tracksForBar(tracks: MdcourseTrack[]): MdcourseTrack[] {
  return tracks
    .map((track, fileIndex) => ({ track, fileIndex }))
    .sort((a, b) => {
      const da = trackDurationRank(a.track);
      const db = trackDurationRank(b.track);
      if (da !== db) return da - db;
      return a.fileIndex - b.fileIndex;
    })
    .map((row) => row.track);
}

export function eachIsoDay(from: string, to: string): string[] {
  const start = normalizeIsoDate(from);
  const end = normalizeIsoDate(to);
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = addIsoDays(cur, 1);
  }
  return out;
}

export function barDateRange(
  tracks: MdcourseTrack[],
  today: string = localIsoDate(),
): { from: string; to: string } {
  const day = normalizeIsoDate(today) ?? localIsoDate();
  if (tracks.length === 0) {
    return { from: day, to: addIsoDays(day, COURSE_ONGOING_PAD_DAYS) };
  }
  let from = tracks[0]!.start;
  let to = day;
  let anyOngoing = false;
  for (const track of tracks) {
    if (track.start < from) from = track.start;
    if (track.ongoing) anyOngoing = true;
    const end = trackEnd(track);
    if (end && end > to) to = end;
  }
  const padded = addIsoDays(day, COURSE_ONGOING_PAD_DAYS);
  if (anyOngoing && padded > to) to = padded;
  if (to < from) to = from;
  return { from, to };
}

function clampTimes(n: number): number {
  if (!Number.isInteger(n)) return COURSE_TIMES_MIN;
  return Math.min(COURSE_TIMES_MAX, Math.max(COURSE_TIMES_MIN, n));
}

export function trackLogOnDay(track: MdcourseTrack, iso: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(track.log, iso)) return null;
  const k = track.log[iso]!;
  if (!Number.isInteger(k) || k < 0) return null;
  return Math.min(track.times, k);
}

export function emptyMdcourse(created: string): string {
  return serializeMdcourse({
    created: normalizeIsoDate(created) ?? localIsoDate(),
    tracks: [],
  });
}

export const EMPTY_MDCOURSE = emptyMdcourse("2026-01-01");

function parseTimes(raw: string, lineNo: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < COURSE_TIMES_MIN || n > COURSE_TIMES_MAX) {
    throw new Error(`Invalid times at line ${lineNo}: ${raw}`);
  }
  return n;
}

function parseDays(raw: string, lineNo: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid days at line ${lineNo}: ${raw}`);
  }
  return n;
}

function parseLog(raw: string, lineNo: number): MdcourseLog {
  const log: MdcourseLog = {};
  for (const part of raw.trim().split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(part);
    if (!m) {
      throw new Error(`Invalid log token at line ${lineNo}: ${part}`);
    }
    const iso = normalizeIsoDate(m[1]!);
    if (!iso) {
      throw new Error(`Invalid log date at line ${lineNo}: ${part}`);
    }
    const k = Number.parseInt(m[2]!, 10);
    if (!Number.isInteger(k) || k < 0) {
      throw new Error(`Invalid log count at line ${lineNo}: ${part}`);
    }
    log[iso] = k;
  }
  return log;
}

function serializeLog(log: MdcourseLog, times: number): string | null {
  const keys = Object.keys(log).sort();
  if (keys.length === 0) return null;
  const parts: string[] = [];
  for (const iso of keys) {
    const k = log[iso]!;
    if (!Number.isInteger(k) || k < 0) continue;
    parts.push(`${iso}:${Math.min(times, k)}`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Parse a `.mdcourse` document. Throws on invalid header or structure. */
export function parseMdcourse(text: string): MdcourseDoc {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const first = (lines[0] ?? "").trim();
  if (first !== MDCOURSE_HEADER) {
    throw new Error(`Invalid .mdcourse header (expected "${MDCOURSE_HEADER}")`);
  }

  let i = 1;
  let created: string | null = null;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;
    const line = lines[i].trim();
    const createdM = /^created:\s*(.*)$/i.exec(line);
    if (createdM) {
      created = normalizeIsoDate(createdM[1] ?? "");
      if (!created) {
        throw new Error(`Invalid created date at line ${i + 1}: ${line}`);
      }
      i += 1;
      continue;
    }
    break;
  }

  if (!created) {
    throw new Error("Missing created: in .mdcourse header");
  }

  const tracks: MdcourseTrack[] = [];
  const seenNames = new Set<string>();

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i += 1;
    if (i >= lines.length) break;

    const nameLine = lines[i].trim();
    if (!nameLine || isMetaKey(nameLine) || /^\d{4}-\d{2}-\d{2}$/.test(nameLine)) {
      throw new Error(
        `Expected track name at line ${i + 1}, got: ${nameLine || "(empty)"}`,
      );
    }
    i += 1;

    const key = trackNameKey(nameLine);
    if (seenNames.has(key)) {
      throw new Error(`Duplicate track name: ${nameLine}`);
    }
    seenNames.add(key);

    let question = "";
    let when = "";
    let time: string[] = [];
    let weekdays: number[] = [];
    let color = "";
    let start: string | null = null;
    let days: number | null = null;
    let ongoing = false;
    let times = COURSE_TIMES_MIN;
    let log: MdcourseLog = {};

    while (i < lines.length && lines[i].trim() !== "") {
      const line = lines[i].trim();
      const q = /^question:\s*(.*)$/i.exec(line);
      if (q) {
        question = (q[1] ?? "").trim();
        i += 1;
        continue;
      }
      const w = /^when:\s*(.*)$/i.exec(line);
      if (w) {
        when = (w[1] ?? "").trim();
        i += 1;
        continue;
      }
      const tm = /^time:\s*(.*)$/i.exec(line);
      if (tm) {
        time = parseClockTimes(tm[1] ?? "", i + 1);
        i += 1;
        continue;
      }
      const wd = /^weekdays:\s*(.*)$/i.exec(line);
      if (wd) {
        weekdays = parseWeekdays(wd[1] ?? "", i + 1);
        i += 1;
        continue;
      }
      const c = /^color:\s*(.*)$/i.exec(line);
      if (c) {
        color = normalizeProjectColor(c[1] ?? "");
        i += 1;
        continue;
      }
      const s = /^start:\s*(.*)$/i.exec(line);
      if (s) {
        start = normalizeIsoDate(s[1] ?? "");
        if (!start) {
          throw new Error(`Invalid start date at line ${i + 1}: ${line}`);
        }
        i += 1;
        continue;
      }
      const d = /^days:\s*(.*)$/i.exec(line);
      if (d) {
        days = parseDays(d[1] ?? "", i + 1);
        i += 1;
        continue;
      }
      const o = /^ongoing:\s*(.*)$/i.exec(line);
      if (o) {
        const v = (o[1] ?? "").trim().toLowerCase();
        ongoing = v === "true" || v === "yes" || v === "1";
        i += 1;
        continue;
      }
      const t = /^times:\s*(.*)$/i.exec(line);
      if (t) {
        times = parseTimes(t[1] ?? "", i + 1);
        i += 1;
        continue;
      }
      const l = /^log:\s*(.*)$/i.exec(line);
      if (l) {
        log = { ...log, ...parseLog(l[1] ?? "", i + 1) };
        i += 1;
        continue;
      }
      throw new Error(`Unexpected line in track entry at ${i + 1}: ${line}`);
    }

    if (!start) {
      throw new Error(`Track "${nameLine}" is missing start:`);
    }
    if (ongoing && days != null) {
      throw new Error(`Track "${nameLine}" cannot have both days: and ongoing:`);
    }
    if (!ongoing && days == null) {
      throw new Error(`Track "${nameLine}" needs days: or ongoing: true`);
    }

    const clampedLog: MdcourseLog = {};
    for (const [iso, k] of Object.entries(log)) {
      clampedLog[iso] = Math.min(times, Math.max(0, k));
    }

    tracks.push({
      name: nameLine,
      question,
      when,
      time,
      weekdays,
      color,
      start,
      days: ongoing ? null : days,
      ongoing,
      times: clampTimes(times),
      log: clampedLog,
    });
  }

  return { created, tracks };
}

export function serializeMdcourse(doc: MdcourseDoc): string {
  const parts: string[] = [MDCOURSE_HEADER, `created: ${doc.created}`, ""];

  for (const track of doc.tracks) {
    parts.push(track.name.trim());
    parts.push(`question: ${track.question.trim()}`);
    if (track.when.trim()) parts.push(`when: ${track.when.trim()}`);
    const timeLine = serializeClockTimes(track.time, clampTimes(track.times));
    if (timeLine) parts.push(`time: ${timeLine}`);
    const weekdayLine = serializeWeekdays(track.weekdays);
    if (weekdayLine) parts.push(`weekdays: ${weekdayLine}`);
    const color = normalizeProjectColor(track.color);
    if (color) parts.push(`color: ${color}`);
    parts.push(`times: ${clampTimes(track.times)}`);
    parts.push(`start: ${track.start}`);
    if (track.ongoing) parts.push("ongoing: true");
    else parts.push(`days: ${track.days ?? 1}`);
    const logLine = serializeLog(track.log, clampTimes(track.times));
    if (logLine) parts.push(`log: ${logLine}`);
    parts.push("");
  }

  return parts.join("\n");
}

export function findTrackIndex(tracks: MdcourseTrack[], name: string): number {
  const key = trackNameKey(name);
  return tracks.findIndex((t) => trackNameKey(t.name) === key);
}

export function applyTrackDay(
  tracks: MdcourseTrack[],
  iso: string,
  answers: Record<string, number | null>,
): MdcourseTrack[] {
  const date = normalizeIsoDate(iso);
  if (!date) throw new Error(`Invalid date: ${iso}`);
  return tracks.map((track) => {
    const key = track.name.trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(answers, key)) return track;
    const k = answers[key];
    const next = { ...track.log };
    if (k == null) {
      delete next[date];
      return { ...track, log: next };
    }
    if (!Number.isInteger(k) || k < 0) return track;
    next[date] = Math.min(track.times, k);
    return { ...track, log: next };
  });
}

export function setTrackDay(
  tracks: MdcourseTrack[],
  name: string,
  iso: string,
  count: number,
): MdcourseTrack[] {
  if (findTrackIndex(tracks, name) < 0) {
    throw new Error(`Track not found: ${name}`);
  }
  return applyTrackDay(tracks, iso, {
    [name.trim().toLowerCase()]: count,
  });
}

export function scheduledDaysCount(track: MdcourseTrack): number {
  if (track.ongoing || track.days == null) return 0;
  const end = trackEnd(track);
  if (!end) return 0;
  let n = 0;
  for (const iso of eachIsoDay(track.start, end)) {
    if (weekdaysActiveOn(track.weekdays, iso)) n += 1;
  }
  return n;
}

export function completeDaysCount(track: MdcourseTrack): number {
  if (track.ongoing || track.days == null) return 0;
  const end = trackEnd(track);
  if (!end) return 0;
  let n = 0;
  for (const iso of eachIsoDay(track.start, end)) {
    if (!weekdaysActiveOn(track.weekdays, iso)) continue;
    if (trackLogOnDay(track, iso) === track.times) n += 1;
  }
  return n;
}

/**
 * Paint one vertical segment (0-based from the top of the section).
 */
export function courseSegmentKind(
  track: MdcourseTrack,
  iso: string,
  segmentIndex: number,
  today: string,
): CourseSegmentKind {
  if (!trackActiveOnDay(track, iso)) return "out";
  const k = trackLogOnDay(track, iso);
  if (k === null) {
    if (iso > today) return "plan";
    if (iso === today) return "plan";
    return "unmarked";
  }
  if (k === 0) return "missed";
  if (segmentIndex < k) return "done";
  return "plan";
}

export function isMonday(iso: string): boolean {
  const n = normalizeIsoDate(iso);
  if (!n) return false;
  const [y, m, d] = n.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getDay() === 1;
}

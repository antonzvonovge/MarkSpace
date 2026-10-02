export type ScheduleFrequency = "daily" | "weekly" | "hourly" | "quarter";

/**
 * `days` uses Sunday = 0 … Saturday = 6. An empty list is every day.
 * Hourly fires at `minute` from `hour` through the last slot that is still
 * at or before `endHour:endMinute` on the same day.
 * Quarter fires every 15 minutes from `hour:minute` through `endHour:endMinute`
 * on the same day. Both ends sit on a quarter hour (:00, :15, :30, :45).
 */
export type RoutineSchedule = {
  hour: number;
  minute: number;
  endHour: number;
  endMinute: number;
  frequency: ScheduleFrequency;
  days: number[];
};

export const SCHEDULE_PRESETS = [
  { label: "Daily 9:00", cron: "0 9 * * *" },
  { label: "Weekdays 9:00", cron: "0 9 * * 1-5" },
  { label: "Hourly", cron: "0 * * * *" },
] as const;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAY_NAMES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function clamp(n: number, max: number, fallback: number): number {
  if (!Number.isInteger(n) || n < 0 || n > max) return fallback;
  return n;
}

function normalizedDays(days: number[]): number[] {
  return [...new Set(days.filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
}

function dowField(days: number[]): string {
  const list = normalizedDays(days);
  if (list.length === 0 || list.length === 7) return "*";
  return list.join(",");
}

/** Last hour that still fires, or null when the end is before the start. */
export function hourlyLastHour(schedule: RoutineSchedule): number | null {
  const minute = clamp(schedule.minute, 59, 0);
  const startHour = clamp(schedule.hour, 23, 0);
  const endHour = clamp(schedule.endHour, 23, 23);
  const endMinute = clamp(schedule.endMinute, 59, 59);
  if (endHour < startHour) return null;
  if (endHour === startHour && minute > endMinute) return null;
  const last = minute <= endMinute ? endHour : endHour - 1;
  return last < startHour ? null : last;
}

const QUARTER_MINUTES = [0, 15, 30, 45] as const;

/** Nearest lower quarter (:00, :15, :30, :45). Values past :59 become :00. */
export function snapQuarterMinute(minute: number): number {
  if (!Number.isInteger(minute) || minute < 0) return 0;
  if (minute > 59) return 0;
  return Math.floor(minute / 15) * 15;
}

function quarterWindow(schedule: RoutineSchedule): { start: number; end: number } | null {
  const start = clamp(schedule.hour, 23, 0) * 60 + snapQuarterMinute(schedule.minute);
  const end = clamp(schedule.endHour, 23, 23) * 60 + snapQuarterMinute(schedule.endMinute);
  if (end < start) return null;
  return { start, end };
}

export function scheduleIssue(schedule: RoutineSchedule): string | null {
  if (schedule.frequency === "weekly" && normalizedDays(schedule.days).length === 0) {
    return "Pick at least one day";
  }
  if (
    (schedule.frequency === "hourly" && hourlyLastHour(schedule) == null) ||
    (schedule.frequency === "quarter" && quarterWindow(schedule) == null)
  ) {
    return "End must be at or after the start";
  }
  return null;
}

function quarterCron(schedule: RoutineSchedule): string {
  const window = quarterWindow(schedule);
  const startAbs = window?.start ?? clamp(schedule.hour, 23, 0) * 60;
  const endAbs = window?.end ?? startAbs;
  const bands: { from: number; to: number; minutes: number[] }[] = [];
  const firstHour = Math.floor(startAbs / 60);
  const lastHour = Math.floor(endAbs / 60);
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    const minutes = QUARTER_MINUTES.filter((minute) => {
      const abs = hour * 60 + minute;
      return abs >= startAbs && abs <= endAbs;
    });
    if (minutes.length === 0) continue;
    const prev = bands[bands.length - 1];
    if (
      prev &&
      prev.to === hour - 1 &&
      prev.minutes.length === minutes.length &&
      prev.minutes.every((minute, index) => minute === minutes[index])
    ) {
      prev.to = hour;
    } else {
      bands.push({ from: hour, to: hour, minutes: [...minutes] });
    }
  }
  const dow = dowField(schedule.days);
  return bands
    .map((band) => {
      const minuteField = band.minutes.length === 4 ? "*/15" : band.minutes.join(",");
      const hourField =
        band.from === 0 && band.to === 23
          ? "*"
          : band.from === band.to
            ? String(band.from)
            : `${band.from}-${band.to}`;
      return `${minuteField} ${hourField} * * ${dow}`;
    })
    .join(";");
}

export function scheduleToCron(schedule: RoutineSchedule): string {
  if (schedule.frequency === "quarter") return quarterCron(schedule);
  const minute = clamp(schedule.minute, 59, 0);
  if (schedule.frequency === "hourly") {
    const startHour = clamp(schedule.hour, 23, 0);
    const last = hourlyLastHour(schedule) ?? startHour;
    const hourField =
      startHour === 0 && last === 23
        ? "*"
        : startHour === last
          ? String(startHour)
          : `${startHour}-${last}`;
    return `${minute} ${hourField} * * ${dowField(schedule.days)}`;
  }
  const hour = clamp(schedule.hour, 23, 9);
  if (schedule.frequency === "daily") {
    return `${minute} ${hour} * * *`;
  }
  return `${minute} ${hour} * * ${dowField(schedule.days)}`;
}

function parseClock(raw: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(raw)) return null;
  const n = Number(raw);
  if (n > max) return null;
  return n;
}

function parseDow(token: string): number | null {
  const name = DAY_NAMES[token.trim().toLowerCase()];
  if (name != null) return name;
  if (!/^\d{1,2}$/.test(token.trim())) return null;
  const n = Number(token.trim());
  if (n < 0 || n > 7) return null;
  return n === 7 ? 0 : n;
}

function parseDays(field: string): number[] | null {
  if (field === "*" || field === "?") return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const piece = part.trim();
    if (!piece || piece.includes("/")) return null;
    if (piece.includes("-")) {
      const [lo, hi] = piece.split("-");
      const start = parseDow(lo ?? "");
      const end = parseDow(hi ?? "");
      if (start == null || end == null || start > end) return null;
      for (let day = start; day <= end; day += 1) days.add(day);
      continue;
    }
    const day = parseDow(piece);
    if (day == null) return null;
    days.add(day);
  }
  if (days.size === 0) return null;
  return [...days].sort((a, b) => a - b);
}

const UNUSED_END = { endHour: 23, endMinute: 59 };

function parseHourField(
  field: string,
): { kind: "all" } | { kind: "span"; start: number; end: number } | null {
  if (field === "*") return { kind: "all" };
  if (field.includes("/") || field.includes(",")) return null;
  if (field.includes("-")) {
    const [lo, hi] = field.split("-");
    const start = parseClock(lo ?? "", 23);
    const end = parseClock(hi ?? "", 23);
    if (start == null || end == null || start > end) return null;
    return { kind: "span", start, end };
  }
  const hour = parseClock(field, 23);
  if (hour == null) return null;
  return { kind: "span", start: hour, end: hour };
}

function parseQuarterMinutes(field: string): number[] | null {
  if (field === "*/15") return [...QUARTER_MINUTES];
  const stepped = /^(\d{1,2})-(\d{1,2})\/15$/.exec(field);
  if (stepped) {
    const lo = Number(stepped[1]);
    const hi = Number(stepped[2]);
    if (lo > hi || lo % 15 !== 0 || hi % 15 !== 0 || hi > 59) return null;
    const minutes: number[] = [];
    for (let minute = lo; minute <= hi; minute += 15) minutes.push(minute);
    return minutes.length > 0 ? minutes : null;
  }
  if (!field.includes(",")) {
    const minute = parseClock(field, 59);
    if (minute == null || minute % 15 !== 0) return null;
    return [minute];
  }
  const minutes: number[] = [];
  for (const part of field.split(",")) {
    const minute = parseClock(part, 59);
    if (minute == null || minute % 15 !== 0) return null;
    if (minutes.length > 0 && minute !== minutes[minutes.length - 1] + 15) return null;
    minutes.push(minute);
  }
  return minutes.length > 1 ? minutes : null;
}

function parseQuarterCron(cron: string): RoutineSchedule | null {
  const parts = cron
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  let startAbs = Number.POSITIVE_INFINITY;
  let endAbs = -1;
  let days: number[] | null = null;
  for (const part of parts) {
    const fields = part.split(/\s+/);
    if (fields.length !== 5) return null;
    const [minuteRaw, hourRaw, dom, month, dow] = fields;
    if (dom !== "*" || month !== "*") return null;
    if (parts.length === 1 && minuteRaw != null && !minuteRaw.includes(",") && !minuteRaw.includes("/")) {
      return null;
    }
    const minutes = parseQuarterMinutes(minuteRaw ?? "");
    const hours = parseHourField(hourRaw ?? "");
    const partDays = parseDays(dow ?? "");
    if (!minutes || !hours || !partDays) return null;
    const normalized = partDays.length === 7 ? [] : partDays;
    if (days == null) days = normalized;
    else if (days.join(",") !== normalized.join(",")) return null;
    const startHour = hours.kind === "all" ? 0 : hours.start;
    const endHour = hours.kind === "all" ? 23 : hours.end;
    const first = startHour * 60 + minutes[0]!;
    const last = endHour * 60 + minutes[minutes.length - 1]!;
    if (first < startAbs) startAbs = first;
    if (last > endAbs) endAbs = last;
  }
  if (days == null || !Number.isFinite(startAbs) || endAbs < 0) return null;
  return {
    frequency: "quarter",
    hour: Math.floor(startAbs / 60),
    minute: startAbs % 60,
    endHour: Math.floor(endAbs / 60),
    endMinute: endAbs % 60,
    days,
  };
}

export function cronToSchedule(cron: string): RoutineSchedule | null {
  const trimmed = cron.trim();
  const minuteField = trimmed.split(/\s+/)[0] ?? "";
  if (trimmed.includes(";") || minuteField.includes(",") || minuteField.includes("/")) {
    return parseQuarterCron(trimmed);
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteRaw, hourRaw, dom, month, dow] = fields;
  if (dom !== "*" || month !== "*") return null;
  const minute = parseClock(minuteRaw ?? "", 59);
  const hours = parseHourField(hourRaw ?? "");
  if (minute == null || !hours) return null;
  const days = parseDays(dow ?? "");
  if (!days) return null;
  const everyDay = days.length === 7;
  if (hours.kind === "all" || hours.start < hours.end) {
    const start = hours.kind === "all" ? 0 : hours.start;
    const end = hours.kind === "all" ? 23 : hours.end;
    return {
      frequency: "hourly",
      hour: start,
      minute,
      endHour: end,
      endMinute: minute,
      days: everyDay ? [] : days,
    };
  }
  const hour = hours.start;
  if (everyDay) {
    return { frequency: "daily", hour, minute, ...UNUSED_END, days: [] };
  }
  return { frequency: "weekly", hour, minute, ...UNUSED_END, days };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isWeekdayList(days: number[]): boolean {
  const weekdays = [1, 2, 3, 4, 5];
  return days.length === weekdays.length && weekdays.every((day, index) => days[index] === day);
}

function dayListLabel(days: number[]): string {
  return days.map((day) => DAY_LABELS[day]).join(", ");
}

export function formatSchedule(cron: string): string {
  const schedule = cronToSchedule(cron);
  if (!schedule) return cron.trim() || "Not set";
  const time = formatTime(schedule.hour, schedule.minute);
  if (schedule.frequency === "quarter") {
    const allDay =
      schedule.hour === 0 &&
      schedule.minute === 0 &&
      schedule.endHour === 23 &&
      schedule.endMinute === 45;
    const allDays = schedule.days.length === 0;
    const end = formatTime(schedule.endHour, schedule.endMinute);
    const range = time === end ? `at ${time}` : `${time}–${end}`;
    if (allDay && allDays) return "Every 15 min";
    if (allDay && isWeekdayList(schedule.days)) return "Every 15 min on weekdays";
    if (allDay) return `Every 15 min on ${dayListLabel(schedule.days)}`;
    if (allDays) return `Every 15 min ${range}`;
    if (isWeekdayList(schedule.days)) return `Every 15 min on weekdays ${range}`;
    return `Every 15 min on ${dayListLabel(schedule.days)} ${range}`;
  }
  if (schedule.frequency === "hourly") {
    const allDay = schedule.hour === 0 && schedule.endHour === 23;
    const allDays = schedule.days.length === 0;
    const end = formatTime(schedule.endHour, schedule.endMinute);
    if (allDay && allDays) {
      return schedule.minute === 0 ? "Hourly" : `Hourly at minute ${schedule.minute}`;
    }
    if (allDay && isWeekdayList(schedule.days)) {
      return schedule.minute === 0
        ? "Hourly on weekdays"
        : `Hourly on weekdays at minute ${schedule.minute}`;
    }
    if (allDay) return `Hourly on ${dayListLabel(schedule.days)}`;
    if (allDays) return `Hourly ${time}–${end}`;
    if (isWeekdayList(schedule.days)) return `Hourly on weekdays ${time}–${end}`;
    return `Hourly on ${dayListLabel(schedule.days)} ${time}–${end}`;
  }
  if (schedule.frequency === "daily") return `Daily at ${time}`;
  if (isWeekdayList(schedule.days)) return `Weekdays at ${time}`;
  return `${dayListLabel(schedule.days)} at ${time}`;
}

export function timeInputValue(schedule: RoutineSchedule): string {
  return formatTime(schedule.hour, schedule.minute);
}

export function endTimeInputValue(schedule: RoutineSchedule): string {
  return formatTime(schedule.endHour, schedule.endMinute);
}

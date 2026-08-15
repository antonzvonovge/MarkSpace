/** Diary day markers — default catalog and helpers. Vault may override via `.markspace/diary.json`. */

export type DayMarker = {
  id: string;
  emoji: string;
  label: string;
};

export const MAX_DAY_MARKERS = 32;
export const MAX_DAY_MARKER_LABEL = 40;
export const MAX_DAY_MARKER_EMOJI_CHARS = 16;

/** Built-in catalog used when the vault has no `diary.json` yet. */
export const DEFAULT_DAY_MARKERS: readonly DayMarker[] = [
  { id: "important", emoji: "⭐", label: "Important" },
  { id: "holiday", emoji: "🎉", label: "Holiday" },
  { id: "birthday", emoji: "🎂", label: "Birthday" },
  { id: "travel", emoji: "✈️", label: "Travel" },
  { id: "work", emoji: "💼", label: "Work" },
  { id: "happy", emoji: "😊", label: "Happy" },
  { id: "sad", emoji: "😢", label: "Sad" },
  { id: "grief", emoji: "🖤", label: "Grief" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "deadline", emoji: "⚠️", label: "Deadline" },
  { id: "health", emoji: "🏥", label: "Health" },
  { id: "rest", emoji: "😴", label: "Rest" },
];

const ID_RE = /^[a-z][a-z0-9-]{0,47}$/;

/** Valid slug id, or empty. Does not require the id to exist in a catalog. */
export function normalizeDayMarkerId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const id = raw.trim().toLowerCase();
  if (!ID_RE.test(id)) return "";
  return id;
}

/** @deprecated use normalizeDayMarkerId */
export const normalizeDayMarker = normalizeDayMarkerId;

export function dayMarkerById(
  id: string,
  catalog: readonly DayMarker[],
): DayMarker | undefined {
  return catalog.find((m) => m.id === id);
}

export function normalizeDayMarkerEmoji(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const emoji = raw.trim();
  if (!emoji) return "";
  const chars = Array.from(emoji);
  if (chars.length > MAX_DAY_MARKER_EMOJI_CHARS) return "";
  return emoji;
}

export function normalizeDayMarkerLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const label = raw.trim();
  if (!label) return "";
  if (Array.from(label).length > MAX_DAY_MARKER_LABEL) {
    return Array.from(label).slice(0, MAX_DAY_MARKER_LABEL).join("");
  }
  return label;
}

export function slugifyDayMarkerId(
  label: string,
  existing: readonly string[],
): string {
  let base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base || !/^[a-z]/.test(base)) {
    base = `marker${base ? `-${base}` : ""}`;
  }
  base = base.slice(0, 48);
  if (!ID_RE.test(base)) base = "marker";
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let n = 2;
  while (n < 1000) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
    if (ID_RE.test(candidate) && !used.has(candidate)) return candidate;
    n += 1;
  }
  return `marker-${Date.now().toString(36)}`.slice(0, 48);
}

function normalizeOne(raw: unknown): DayMarker | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = normalizeDayMarkerId(rec.id);
  const emoji = normalizeDayMarkerEmoji(rec.emoji);
  const label = normalizeDayMarkerLabel(rec.label);
  if (!id || !emoji || !label) return null;
  return { id, emoji, label };
}

/** Drop invalid / duplicate ids; cap length. */
export function normalizeDayMarkerCatalog(raw: unknown): DayMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: DayMarker[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const marker = normalizeOne(item);
    if (!marker || seen.has(marker.id)) continue;
    seen.add(marker.id);
    out.push(marker);
    if (out.length >= MAX_DAY_MARKERS) break;
  }
  return out;
}

/**
 * `null` markers in the vault file means “use built-in defaults”.
 * An explicit empty array is a user-cleared catalog.
 */
export function catalogFromVaultMarkers(
  markers: DayMarker[] | null | undefined,
): DayMarker[] {
  if (markers == null) return DEFAULT_DAY_MARKERS.map((m) => ({ ...m }));
  return markers;
}

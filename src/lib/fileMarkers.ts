/** File markers — default catalog and helpers. Vault may override via `.markspace/file-markers.json`. */

export type FileMarker = {
  id: string;
  emoji: string;
  label: string;
};

export const MAX_FILE_MARKERS = 32;
export const MAX_FILE_MARKER_LABEL = 40;
export const MAX_FILE_MARKER_EMOJI_CHARS = 16;

/** Built-in catalog used when the vault has no `file-markers.json` yet. */
export const DEFAULT_FILE_MARKERS: readonly FileMarker[] = [
  { id: "done", emoji: "✅", label: "Done" },
  { id: "skipped", emoji: "⏭️", label: "Skipped" },
  { id: "needs-work", emoji: "🔧", label: "Needs work" },
];

const ID_RE = /^[a-z][a-z0-9-]{0,47}$/;

/** Valid slug id, or empty. Does not require the id to exist in a catalog. */
export function normalizeFileMarkerId(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const id = raw.trim().toLowerCase();
  if (!ID_RE.test(id)) return "";
  return id;
}

export function fileMarkerById(
  id: string,
  catalog: readonly FileMarker[],
): FileMarker | undefined {
  return catalog.find((m) => m.id === id);
}

export function normalizeFileMarkerEmoji(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const emoji = raw.trim();
  if (!emoji) return "";
  const chars = Array.from(emoji);
  if (chars.length > MAX_FILE_MARKER_EMOJI_CHARS) return "";
  return emoji;
}

export function normalizeFileMarkerLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const label = raw.trim();
  if (!label) return "";
  if (Array.from(label).length > MAX_FILE_MARKER_LABEL) {
    return Array.from(label).slice(0, MAX_FILE_MARKER_LABEL).join("");
  }
  return label;
}

export function slugifyFileMarkerId(
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

function normalizeOne(raw: unknown): FileMarker | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const id = normalizeFileMarkerId(rec.id);
  const emoji = normalizeFileMarkerEmoji(rec.emoji);
  const label = normalizeFileMarkerLabel(rec.label);
  if (!id || !emoji || !label) return null;
  return { id, emoji, label };
}

/** Drop invalid / duplicate ids; cap length. */
export function normalizeFileMarkerCatalog(raw: unknown): FileMarker[] {
  if (!Array.isArray(raw)) return [];
  const out: FileMarker[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const marker = normalizeOne(item);
    if (!marker || seen.has(marker.id)) continue;
    seen.add(marker.id);
    out.push(marker);
    if (out.length >= MAX_FILE_MARKERS) break;
  }
  return out;
}

/**
 * `null` markers in the vault file means “use built-in defaults”.
 * An explicit empty array is a user-cleared catalog.
 */
export function catalogFromVaultFileMarkers(
  markers: FileMarker[] | null | undefined,
): FileMarker[] {
  if (markers == null) return DEFAULT_FILE_MARKERS.map((m) => ({ ...m }));
  return markers;
}

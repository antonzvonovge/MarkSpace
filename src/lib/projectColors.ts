/** Material Design 500 swatches for project color (user-chosen, optional). */

export type ProjectColorSwatch = {
  id: string;
  label: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
};

/** Fixed palette — only these values (or empty) may be stored. */
export const PROJECT_COLOR_SWATCHES: readonly ProjectColorSwatch[] = [
  { id: "red", label: "Red", hex: "#f44336" },
  { id: "pink", label: "Pink", hex: "#e91e63" },
  { id: "purple", label: "Purple", hex: "#9c27b0" },
  { id: "deepPurple", label: "Deep purple", hex: "#673ab7" },
  { id: "indigo", label: "Indigo", hex: "#3f51b5" },
  { id: "blue", label: "Blue", hex: "#2196f3" },
  { id: "lightBlue", label: "Light blue", hex: "#03a9f4" },
  { id: "cyan", label: "Cyan", hex: "#00bcd4" },
  { id: "teal", label: "Teal", hex: "#009688" },
  { id: "green", label: "Green", hex: "#4caf50" },
  { id: "lightGreen", label: "Light green", hex: "#8bc34a" },
  { id: "lime", label: "Lime", hex: "#cddc39" },
  { id: "amber", label: "Amber", hex: "#ffc107" },
  { id: "orange", label: "Orange", hex: "#ff9800" },
  { id: "deepOrange", label: "Deep orange", hex: "#ff5722" },
  { id: "brown", label: "Brown", hex: "#795548" },
  { id: "blueGrey", label: "Blue grey", hex: "#607d8b" },
] as const;

const HEX_SET = new Set(
  PROJECT_COLOR_SWATCHES.map((s) => s.hex.toLowerCase()),
);

export function isProjectColor(hex: string): boolean {
  return HEX_SET.has(hex.trim().toLowerCase());
}

/** Empty string = unset; otherwise a whitelist hex or "". */
export function normalizeProjectColor(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  return HEX_SET.has(trimmed) ? trimmed : "";
}

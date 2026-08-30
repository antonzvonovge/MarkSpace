import type { CSSProperties } from "react";

/** Light muted matte Material pastels for per-name chips (task labels, etc.). */

export type PastelChipSwatch = {
  bg: string;
  bgHover: string;
  border: string;
  text: string;
};

/** Material 50 fill / 100 border / 700–800 ink — soft, not neon. */
export const PASTEL_CHIP_SWATCHES: readonly PastelChipSwatch[] = [
  { bg: "#ffebef", bgHover: "#ffcdd2", border: "#ef9a9a", text: "#c62828" }, // red
  { bg: "#fce4ec", bgHover: "#f8bbd0", border: "#f48fb1", text: "#ad1457" }, // pink
  { bg: "#f3e5f5", bgHover: "#e1bee7", border: "#ce93d8", text: "#6a1b9a" }, // purple
  { bg: "#ede7f6", bgHover: "#d1c4e9", border: "#b39ddb", text: "#4527a0" }, // deep purple
  { bg: "#e8eaf6", bgHover: "#c5cae9", border: "#9fa8da", text: "#283593" }, // indigo
  { bg: "#e3f2fd", bgHover: "#bbdefb", border: "#90caf9", text: "#1565c0" }, // blue
  { bg: "#e1f5fe", bgHover: "#b3e5fc", border: "#81d4fa", text: "#0277bd" }, // light blue
  { bg: "#e0f7fa", bgHover: "#b2ebf2", border: "#80deea", text: "#00838f" }, // cyan
  { bg: "#e0f2f1", bgHover: "#b2dfdb", border: "#80cbc4", text: "#00695c" }, // teal
  { bg: "#e8f5e9", bgHover: "#c8e6c9", border: "#a5d6a7", text: "#2e7d32" }, // green
  { bg: "#f1f8e9", bgHover: "#dcedc8", border: "#c5e1a5", text: "#558b2f" }, // light green
  { bg: "#f9fbe7", bgHover: "#f0f4c3", border: "#e6ee9c", text: "#9e9d24" }, // lime
  { bg: "#fff8e1", bgHover: "#ffecb3", border: "#ffe082", text: "#ff8f00" }, // amber
  { bg: "#fff3e0", bgHover: "#ffe0b2", border: "#ffcc80", text: "#ef6c00" }, // orange
  { bg: "#fbe9e7", bgHover: "#ffccbc", border: "#ffab91", text: "#d84315" }, // deep orange
  { bg: "#efebe9", bgHover: "#d7ccc8", border: "#bcaaa4", text: "#5d4037" }, // brown
  { bg: "#eceff1", bgHover: "#cfd8dc", border: "#b0bec5", text: "#455a64" }, // blue grey
] as const;

function hashName(name: string): number {
  let h = 0;
  const s = name.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Stable pastel for a tag/label name (case-insensitive). */
export function pastelChipForName(name: string): PastelChipSwatch {
  const i = hashName(name) % PASTEL_CHIP_SWATCHES.length;
  return PASTEL_CHIP_SWATCHES[i]!;
}

/** CSS custom properties matching `.page-tag-chip` vars. */
export function pastelChipStyle(name: string): CSSProperties {
  const s = pastelChipForName(name);
  return {
    ["--tag-bg" as string]: s.bg,
    ["--tag-bg-hover" as string]: s.bgHover,
    ["--tag-border" as string]: s.border,
    ["--tag-text" as string]: s.text,
  };
}

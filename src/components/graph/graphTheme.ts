/** Theme tokens read from CSS variables for the sigma graph. */

export type GraphTheme = {
  accent: string;
  accentStrong: string;
  text: string;
  muted: string;
  bg: string;
  surface: string;
  /** Tag nodes. */
  tag: string;
  /** Page (note) nodes: muted matte accent, solid fill. */
  note: string;
  /** Pages with no tags — same hue, drained almost to grey. */
  noteQuiet: string;
  edge: string;
  label: string;
};

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

export function readGraphTheme(): GraphTheme {
  const accent = cssVar("--accent", "#cb11ab");
  const text = cssVar("--text", "#1c2428");
  const muted = cssVar("--muted", "#5d6b73");
  const bg = cssVar("--bg", "#f3f1ec");
  const surface = cssVar("--editor-surface", cssVar("--bg-elevated", bg));
  const dark = isDarkTheme();
  const accentHue = parseHue(accent);
  return {
    accent,
    accentStrong: cssVar("--accent-strong", "#a00e89"),
    text,
    muted,
    bg,
    surface,
    tag: hslToHex(212, dark ? 62 : 58, dark ? 62 : 48),
    note: hslToHex(accentHue, dark ? 40 : 45, dark ? 62 : 55),
    noteQuiet: hslToHex(accentHue, 16, dark ? 42 : 74),
    edge: withAlpha(muted, 0.55),
    label: text,
  };
}

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

type Rgba = { r: number; g: number; b: number; a: number };

/** Parse the color forms sigma accepts (hex, `rgb()`, `rgba()`). */
function parseColor(color: string): Rgba | null {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
        a: 1,
      };
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!rgb) return null;
  const parts = rgb[1]!.split(",").map((p) => Number(p.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return null;
  }
  const a = parts.length > 3 && Number.isFinite(parts[3]!) ? parts[3]! : 1;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a };
}

function toRgba({ r, g, b, a }: Rgba, alpha = a): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Hex (#rgb / #rrggbb) or css color → rgba string. Falls back to raw color. */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  return toRgba(parsed, alpha);
}

/** Scale a color's existing alpha, e.g. to fade a node out during hover. */
export function scaleAlpha(color: string, factor: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  return toRgba(parsed, parsed.a * factor);
}

/** Linear blend of two colors; `t` of 0 keeps `from`, 1 gives `to`. */
export function mixColors(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t > 0.5 ? to : from;
  const k = Math.min(1, Math.max(0, t));
  return toRgba({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: a.a + (b.a - a.a) * k,
  });
}

/**
 * Hex only: sigma's WebGL color parser understands hex / rgb() / named colors
 * and silently renders anything else (hsl()) as black.
 */
function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function parseHue(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 312; // ~#cb11ab
  const h = m[1]!;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let hue = 0;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return hue;
}

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

/** Default brand accent (Wildberries magenta). */
export const DEFAULT_ACCENT_HEX = "#cb11ab";

export type Rgb = { r: number; g: number; b: number };

function clampByte(n: number): number {
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function parseHexColor(raw: unknown): Rgb | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  const six = /^#([0-9a-f]{6})$/.exec(s);
  if (six) {
    const n = six[1]!;
    return {
      r: parseInt(n.slice(0, 2), 16),
      g: parseInt(n.slice(2, 4), 16),
      b: parseInt(n.slice(4, 6), 16),
    };
  }
  const three = /^#([0-9a-f]{3})$/.exec(s);
  if (three) {
    const n = three[1]!;
    return {
      r: parseInt(n[0]! + n[0]!, 16),
      g: parseInt(n[1]! + n[1]!, 16),
      b: parseInt(n[2]! + n[2]!, 16),
    };
  }
  return null;
}

export function hexToRgb(hex: string): Rgb {
  return parseHexColor(hex) ?? { r: 203, g: 17, b: 171 };
}

export function normalizeAccentHex(raw: unknown): string {
  const rgb = parseHexColor(raw);
  return rgb ? rgbToHex(rgb) : DEFAULT_ACCENT_HEX;
}

/** Darker companion for `--accent-strong` (~0.8× RGB, matching #cb11ab → #a00e89). */
export function accentStrongHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * 0.8, g: g * 0.8, b: b * 0.8 });
}

export function applyAccentToElement(
  el: HTMLElement,
  hex: string,
): void {
  const n = normalizeAccentHex(hex);
  const { r, g, b } = hexToRgb(n);
  el.style.setProperty("--accent", n);
  el.style.setProperty("--accent-wb", n);
  el.style.setProperty("--accent-strong", accentStrongHex(n));
  el.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
}

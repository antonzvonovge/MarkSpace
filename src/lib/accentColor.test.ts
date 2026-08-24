import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT_HEX,
  accentStrongHex,
  normalizeAccentHex,
  parseHexColor,
  rgbToHex,
} from "./accentColor";

describe("accentColor", () => {
  it("parses #rrggbb and #rgb", () => {
    expect(parseHexColor("#cb11ab")).toEqual({ r: 203, g: 17, b: 171 });
    expect(parseHexColor("#ABC")).toEqual({ r: 170, g: 187, b: 204 });
  });

  it("normalizes invalid values to the default", () => {
    expect(normalizeAccentHex("not a color")).toBe(DEFAULT_ACCENT_HEX);
    expect(normalizeAccentHex("#cb11ab")).toBe("#cb11ab");
    expect(normalizeAccentHex("#CB11AB")).toBe("#cb11ab");
  });

  it("darkens the default magenta toward --accent-strong", () => {
    expect(accentStrongHex(DEFAULT_ACCENT_HEX)).toBe(
      rgbToHex({ r: 203 * 0.8, g: 17 * 0.8, b: 171 * 0.8 }),
    );
  });
});

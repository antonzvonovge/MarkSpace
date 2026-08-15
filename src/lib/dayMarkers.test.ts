import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAY_MARKERS,
  catalogFromVaultMarkers,
  dayMarkerById,
  normalizeDayMarkerCatalog,
  normalizeDayMarkerEmoji,
  normalizeDayMarkerId,
  slugifyDayMarkerId,
} from "./dayMarkers";

describe("dayMarkers", () => {
  it("has unique default ids", () => {
    const ids = DEFAULT_DAY_MARKERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks up catalog entries", () => {
    expect(dayMarkerById("holiday", DEFAULT_DAY_MARKERS)?.emoji).toBe("🎉");
    expect(dayMarkerById("nope", DEFAULT_DAY_MARKERS)).toBeUndefined();
  });

  it("normalizes slug ids", () => {
    expect(normalizeDayMarkerId("holiday")).toBe("holiday");
    expect(normalizeDayMarkerId("  Rest  ")).toBe("rest");
    expect(normalizeDayMarkerId("my-marker")).toBe("my-marker");
    expect(normalizeDayMarkerId("")).toBe("");
    expect(normalizeDayMarkerId("🎉")).toBe("");
    expect(normalizeDayMarkerId("1bad")).toBe("");
    expect(normalizeDayMarkerId(null)).toBe("");
  });

  it("normalizes emoji and catalog rows", () => {
    expect(normalizeDayMarkerEmoji(" 🎉 ")).toBe("🎉");
    expect(normalizeDayMarkerEmoji("")).toBe("");
    expect(
      normalizeDayMarkerCatalog([
        { id: "holiday", emoji: "🎉", label: "Holiday" },
        { id: "holiday", emoji: "x", label: "Dup" },
        { id: "bad", emoji: "", label: "Nope" },
        { id: "ok", emoji: "⭐", label: " Star " },
      ]),
    ).toEqual([
      { id: "holiday", emoji: "🎉", label: "Holiday" },
      { id: "ok", emoji: "⭐", label: "Star" },
    ]);
  });

  it("treats null vault markers as defaults and [] as empty", () => {
    expect(catalogFromVaultMarkers(null)).toEqual(DEFAULT_DAY_MARKERS);
    expect(catalogFromVaultMarkers(undefined)).toEqual(DEFAULT_DAY_MARKERS);
    expect(catalogFromVaultMarkers([])).toEqual([]);
  });

  it("slugifies labels without colliding", () => {
    expect(slugifyDayMarkerId("Holiday", [])).toBe("holiday");
    expect(slugifyDayMarkerId("Holiday", ["holiday"])).toBe("holiday-2");
    expect(slugifyDayMarkerId("🎉", [])).toBe("marker");
  });
});

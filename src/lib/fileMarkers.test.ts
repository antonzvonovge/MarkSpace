import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_MARKERS,
  catalogFromVaultFileMarkers,
  fileMarkerById,
  normalizeFileMarkerCatalog,
  normalizeFileMarkerId,
  slugifyFileMarkerId,
} from "./fileMarkers";

describe("fileMarkers", () => {
  it("normalizes valid ids", () => {
    expect(normalizeFileMarkerId("Done")).toBe("done");
    expect(normalizeFileMarkerId("needs-work")).toBe("needs-work");
    expect(normalizeFileMarkerId("✅")).toBe("");
    expect(normalizeFileMarkerId("")).toBe("");
  });

  it("looks up by id", () => {
    expect(fileMarkerById("done", DEFAULT_FILE_MARKERS)?.emoji).toBe("✅");
    expect(fileMarkerById("nope", DEFAULT_FILE_MARKERS)).toBeUndefined();
  });

  it("uses defaults when vault catalog is null", () => {
    expect(catalogFromVaultFileMarkers(null)).toEqual(
      DEFAULT_FILE_MARKERS.map((m) => ({ ...m })),
    );
    expect(catalogFromVaultFileMarkers([])).toEqual([]);
  });

  it("drops invalid catalog entries", () => {
    expect(
      normalizeFileMarkerCatalog([
        { id: "ok", emoji: "✅", label: "Ok" },
        { id: "ok", emoji: "x", label: "Dup" },
        { id: "1bad", emoji: "✅", label: "Nope" },
        { id: "empty", emoji: "", label: "No" },
      ]),
    ).toEqual([{ id: "ok", emoji: "✅", label: "Ok" }]);
  });

  it("slugifies labels uniquely", () => {
    expect(slugifyFileMarkerId("Needs Work", [])).toBe("needs-work");
    expect(slugifyFileMarkerId("Needs Work", ["needs-work"])).toBe(
      "needs-work-2",
    );
  });
});

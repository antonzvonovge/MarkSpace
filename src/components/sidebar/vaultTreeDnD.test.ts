import { describe, expect, it } from "vitest";
import { hitTestVirtualRow } from "./vaultTreeDnD";

describe("hitTestVirtualRow", () => {
  const items = [
    { index: 0, start: 0, size: 28 },
    { index: 1, start: 28, size: 28 },
    { index: 2, start: 56, size: 28 },
  ];

  it("hits the row under the pointer", () => {
    // listTop=100, scrollMargin=0 → row1 screen [128, 156)
    const hit = hitTestVirtualRow(140, 100, 0, items);
    expect(hit).toEqual({ index: 1, ratio: expect.closeTo(12 / 28, 5) });
  });

  it("accounts for scrollMargin like WorkspaceTree translateY", () => {
    // translateY = start - scrollMargin; row0 screen top = 100 + 0 - 40 = 60
    const hit = hitTestVirtualRow(70, 100, 40, items);
    expect(hit?.index).toBe(0);
    expect(hit?.ratio).toBeCloseTo(10 / 28, 5);
  });

  it("clamps above the first visible row", () => {
    const hit = hitTestVirtualRow(50, 100, 0, items);
    expect(hit).toEqual({ index: 0, ratio: 0 });
  });

  it("clamps below the last visible row", () => {
    const hit = hitTestVirtualRow(400, 100, 0, items);
    expect(hit).toEqual({ index: 2, ratio: 1 });
  });

  it("returns null for an empty list", () => {
    expect(hitTestVirtualRow(100, 0, 0, [])).toBeNull();
  });
});

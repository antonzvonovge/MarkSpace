/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  placeAnchoredMenu,
  placeFlyoutMenu,
  placePointerMenu,
} from "./menuPlacement";

function rect(
  partial: Partial<DOMRect> & Pick<DOMRect, "top" | "bottom" | "left" | "right">,
): DOMRect {
  const width = partial.width ?? partial.right - partial.left;
  const height = partial.height ?? partial.bottom - partial.top;
  return {
    x: partial.left,
    y: partial.top,
    top: partial.top,
    bottom: partial.bottom,
    left: partial.left,
    right: partial.right,
    width,
    height,
    toJSON() {
      return this;
    },
  };
}

function stubViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("placeAnchoredMenu", () => {
  afterEach(() => {
    stubViewport(1024, 768);
  });

  it("prefers below when there is room", () => {
    stubViewport(1000, 800);
    const placed = placeAnchoredMenu(
      rect({ top: 100, bottom: 130, left: 40, right: 200 }),
      { width: 160, minHeight: 120 },
    );
    expect(placed.side).toBe("below");
    expect(placed.top).toBe(136);
    expect(placed.bottom).toBeNull();
  });

  it("opens above when below is cramped", () => {
    stubViewport(1000, 400);
    const placed = placeAnchoredMenu(
      rect({ top: 320, bottom: 350, left: 40, right: 200 }),
      { width: 160, minHeight: 120, prefer: "below" },
    );
    expect(placed.side).toBe("above");
    expect(placed.top).toBeNull();
    expect(placed.bottom).toBeGreaterThan(0);
  });

  it("honors prefer above when both sides fit", () => {
    stubViewport(1000, 800);
    const placed = placeAnchoredMenu(
      rect({ top: 400, bottom: 430, left: 40, right: 200 }),
      { width: 160, minHeight: 120, prefer: "above" },
    );
    expect(placed.side).toBe("above");
  });

  it("force below wins over prefer above", () => {
    stubViewport(1000, 800);
    const placed = placeAnchoredMenu(
      rect({ top: 400, bottom: 430, left: 40, right: 200 }),
      { width: 160, prefer: "above", force: "below" },
    );
    expect(placed.side).toBe("below");
  });
});

describe("placePointerMenu", () => {
  const viewport = { width: 1000, height: 800 };

  it("anchors the top-left on the cursor when the menu fits", () => {
    expect(placePointerMenu(40, 80, { width: 220, height: 160 }, viewport)).toEqual({
      left: 40,
      top: 80,
    });
  });

  it("flips above the cursor when the bottom would clip", () => {
    expect(placePointerMenu(40, 720, { width: 220, height: 160 }, viewport)).toEqual({
      left: 40,
      top: 560,
    });
  });

  it("flips left of the cursor when the right edge would clip", () => {
    expect(placePointerMenu(900, 80, { width: 220, height: 160 }, viewport)).toEqual({
      left: 680,
      top: 80,
    });
  });
});

describe("placeFlyoutMenu", () => {
  const viewport = { width: 1000, height: 800 };

  it("opens to the right of the anchor row", () => {
    expect(
      placeFlyoutMenu(
        { top: 200, left: 40, right: 240 },
        { width: 180, height: 220 },
        viewport,
      ),
    ).toEqual({ left: 238, top: 200 });
  });

  it("opens to the left and shifts up when the flyout would clip", () => {
    expect(
      placeFlyoutMenu(
        { top: 700, left: 800, right: 980 },
        { width: 180, height: 220 },
        viewport,
      ),
    ).toEqual({ left: 622, top: 572 });
  });
});

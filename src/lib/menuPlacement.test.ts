/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { placeAnchoredMenu } from "./menuPlacement";

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

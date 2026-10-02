import { describe, expect, it } from "vitest";
import { resizeImage } from "./imageResize";

const origin = {
  startX: 100,
  startY: 100,
  startWidth: 200,
  startHeight: 80,
  maxWidth: 800,
} as const;

describe("resizeImage", () => {
  it("changes width from the east edge and leaves height alone", () => {
    expect(resizeImage({ ...origin, handle: "e" }, 130, 140)).toEqual({
      width: 230,
      height: 80,
    });
  });

  it("grows width when the west edge is dragged left", () => {
    expect(resizeImage({ ...origin, handle: "w" }, 70, 100)).toEqual({
      width: 230,
      height: 80,
    });
  });

  it("changes height from the south edge", () => {
    expect(resizeImage({ ...origin, handle: "s" }, 100, 150)).toEqual({
      width: 200,
      height: 130,
    });
  });

  it("grows height when the north edge is dragged up", () => {
    expect(resizeImage({ ...origin, handle: "n" }, 100, 60)).toEqual({
      width: 200,
      height: 120,
    });
  });

  it("stretches both axes from a corner", () => {
    expect(resizeImage({ ...origin, handle: "se" }, 140, 90)).toEqual({
      width: 240,
      height: 70,
    });
  });

  it("doubles the width delta for a centered image", () => {
    expect(
      resizeImage(
        { ...origin, handle: "e", textAlignment: "center" },
        120,
        100,
      ),
    ).toEqual({ width: 240, height: 80 });
  });

  it("clamps to the editor width and the minimum edge", () => {
    expect(resizeImage({ ...origin, handle: "e" }, 5000, 100)).toEqual({
      width: 800,
      height: 80,
    });
    expect(
      resizeImage(
        { ...origin, handle: "e", startWidth: 40 },
        0,
        100,
      ),
    ).toEqual({ width: 32, height: 80 });
  });
});

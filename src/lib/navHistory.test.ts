import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  currentNavPath,
  emptyNavHistory,
  moveNavBack,
  moveNavForward,
  NAV_HISTORY_LIMIT,
  pushNavVisit,
  remapNavHistory,
} from "./navHistory";

describe("pushNavVisit", () => {
  it("appends and advances index", () => {
    let s = emptyNavHistory();
    s = pushNavVisit(s, "a.md");
    s = pushNavVisit(s, "b.md");
    expect(s).toEqual({ paths: ["a.md", "b.md"], index: 1 });
  });

  it("no-ops when path equals current", () => {
    const s = pushNavVisit(pushNavVisit(emptyNavHistory(), "a.md"), "a.md");
    expect(s).toEqual({ paths: ["a.md"], index: 0 });
  });

  it("truncates forward stack before append", () => {
    let s = pushNavVisit(pushNavVisit(emptyNavHistory(), "a.md"), "b.md");
    s = moveNavBack(s)!;
    s = pushNavVisit(s, "c.md");
    expect(s).toEqual({ paths: ["a.md", "c.md"], index: 1 });
    expect(canGoForward(s)).toBe(false);
  });

  it("allows revisiting earlier paths chronologically", () => {
    let s = emptyNavHistory();
    s = pushNavVisit(s, "a.md");
    s = pushNavVisit(s, "b.md");
    s = pushNavVisit(s, "a.md");
    expect(s.paths).toEqual(["a.md", "b.md", "a.md"]);
    expect(s.index).toBe(2);
  });

  it("caps at NAV_HISTORY_LIMIT from the front", () => {
    let s = emptyNavHistory();
    for (let i = 0; i < NAV_HISTORY_LIMIT + 5; i++) {
      s = pushNavVisit(s, `${i}.md`);
    }
    expect(s.paths).toHaveLength(NAV_HISTORY_LIMIT);
    expect(s.paths[0]).toBe("5.md");
    expect(s.paths[s.paths.length - 1]).toBe(`${NAV_HISTORY_LIMIT + 4}.md`);
    expect(s.index).toBe(NAV_HISTORY_LIMIT - 1);
  });
});

describe("moveNavBack / moveNavForward", () => {
  it("moves index without changing paths", () => {
    let s = pushNavVisit(pushNavVisit(emptyNavHistory(), "a.md"), "b.md");
    expect(canGoBack(s)).toBe(true);
    expect(canGoForward(s)).toBe(false);

    s = moveNavBack(s)!;
    expect(currentNavPath(s)).toBe("a.md");
    expect(canGoBack(s)).toBe(false);
    expect(canGoForward(s)).toBe(true);

    s = moveNavForward(s)!;
    expect(currentNavPath(s)).toBe("b.md");
  });

  it("returns null at bounds", () => {
    const s = pushNavVisit(emptyNavHistory(), "a.md");
    expect(moveNavBack(s)).toBeNull();
    expect(moveNavForward(s)).toBeNull();
  });
});

describe("remapNavHistory", () => {
  it("remaps moved file and nested paths", () => {
    const s = {
      paths: ["Proj/a.md", "Proj/sub/b.md", "Other/c.md"],
      index: 1,
    };
    expect(remapNavHistory(s, "Proj", "Lang")).toEqual({
      paths: ["Lang/a.md", "Lang/sub/b.md", "Other/c.md"],
      index: 1,
    });
  });

  it("drops deleted paths and adjusts index", () => {
    const s = {
      paths: ["a.md", "gone.md", "c.md"],
      index: 2,
    };
    expect(remapNavHistory(s, "gone.md", null)).toEqual({
      paths: ["a.md", "c.md"],
      index: 1,
    });
  });

  it("collapses consecutive duplicates after remap", () => {
    const s = {
      paths: ["Old/a.md", "New/a.md", "b.md"],
      index: 1,
    };
    expect(remapNavHistory(s, "Old/a.md", "New/a.md")).toEqual({
      paths: ["New/a.md", "b.md"],
      index: 0,
    });
  });

  it("returns empty when all entries deleted", () => {
    const s = { paths: ["Proj/a.md", "Proj/b.md"], index: 1 };
    expect(remapNavHistory(s, "Proj", null)).toEqual(emptyNavHistory());
  });
});

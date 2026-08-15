import { describe, expect, it } from "vitest";
import {
  groupPinnedTabs,
  lastPinnedIndex,
  reorderEditorTabs,
  setTabPinned,
  keepForCloseOthers,
  keepForCloseToTheRight,
  type PinnableTab,
} from "./editorTabs";

function tabs(
  ...items: Array<string | { path: string; pinned?: boolean; preview?: boolean }>
): PinnableTab[] {
  return items.map((item) =>
    typeof item === "string" ? { path: item } : item,
  );
}

describe("groupPinnedTabs", () => {
  it("returns the same array when already grouped", () => {
    const input = tabs(
      { path: "a", pinned: true },
      { path: "b", pinned: true },
      "c",
    );
    expect(groupPinnedTabs(input)).toBe(input);
  });

  it("moves mixed pinned tabs to a left prefix", () => {
    expect(
      groupPinnedTabs(
        tabs("a", { path: "b", pinned: true }, "c", { path: "d", pinned: true }),
      ).map((t) => t.path),
    ).toEqual(["b", "d", "a", "c"]);
  });
});

describe("setTabPinned", () => {
  it("pins to the end of the pinned prefix and clears preview", () => {
    const next = setTabPinned(
      tabs({ path: "a", pinned: true }, "b", { path: "c", preview: true }),
      "c",
      true,
    );
    expect(next.map((t) => t.path)).toEqual(["a", "c", "b"]);
    expect(next[1]).toMatchObject({ path: "c", pinned: true, preview: false });
  });

  it("unpins to the start of the unpinned group", () => {
    const next = setTabPinned(
      tabs({ path: "a", pinned: true }, { path: "b", pinned: true }, "c"),
      "a",
      false,
    );
    expect(next.map((t) => t.path)).toEqual(["b", "a", "c"]);
    expect(next[1]?.pinned).toBe(false);
  });

  it("no-ops when already in the requested state", () => {
    const input = tabs({ path: "a", pinned: true }, "b");
    expect(setTabPinned(input, "a", true)).toBe(input);
    expect(setTabPinned(input, "b", false)).toBe(input);
  });
});

describe("reorderEditorTabs", () => {
  it("reorders inside the pinned group without unpinning", () => {
    const next = reorderEditorTabs(
      tabs({ path: "a", pinned: true }, { path: "b", pinned: true }, "c"),
      0,
      1,
    );
    expect(next.map((t) => t.path)).toEqual(["b", "a", "c"]);
    expect(next.filter((t) => t.pinned).map((t) => t.path)).toEqual(["b", "a"]);
  });

  it("pins when dropped into the pinned prefix", () => {
    const next = reorderEditorTabs(
      tabs({ path: "a", pinned: true }, { path: "b", pinned: true }, "c", "d"),
      3,
      1,
    );
    expect(next.map((t) => t.path)).toEqual(["a", "d", "b", "c"]);
    expect(next[1]).toMatchObject({ path: "d", pinned: true });
  });

  it("unpins when dropped after the pinned prefix", () => {
    const next = reorderEditorTabs(
      tabs({ path: "a", pinned: true }, { path: "b", pinned: true }, "c"),
      1,
      2,
    );
    expect(next.map((t) => t.path)).toEqual(["a", "c", "b"]);
    expect(next[2]).toMatchObject({ path: "b", pinned: false });
  });

  it("does not pin when nothing is pinned yet", () => {
    const next = reorderEditorTabs(tabs("a", "b", "c"), 2, 0);
    expect(next.map((t) => t.path)).toEqual(["c", "a", "b"]);
    expect(next.every((t) => !t.pinned)).toBe(true);
  });
});

describe("lastPinnedIndex", () => {
  it("returns -1 when none are pinned", () => {
    expect(lastPinnedIndex(tabs("a", "b"))).toBe(-1);
  });

  it("returns the last pinned index", () => {
    expect(
      lastPinnedIndex(tabs({ path: "a", pinned: true }, { path: "b", pinned: true }, "c")),
    ).toBe(1);
  });
});

describe("keepForCloseOthers", () => {
  it("keeps the clicked tab and all pins", () => {
    const ids = keepForCloseOthers(
      tabs({ path: "a", pinned: true }, "b", "c", { path: "d", pinned: true }),
      "b",
    );
    expect([...ids].sort()).toEqual(["a", "b", "d"]);
  });
});

describe("keepForCloseToTheRight", () => {
  it("keeps left tabs, the clicked tab, and pins to the right", () => {
    const ids = keepForCloseToTheRight(
      tabs({ path: "a", pinned: true }, "b", "c", { path: "d", pinned: true }, "e"),
      "b",
    );
    expect([...ids].sort()).toEqual(["a", "b", "d"]);
  });
});

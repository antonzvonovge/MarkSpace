import { describe, expect, it } from "vitest";
import {
  expandSelectionMarkers,
  extractSelectionIds,
  parseUserTextSegments,
  selectionChipLabel,
  wrapSelectionMarker,
  type ChatSelectionRef,
} from "./chatSelectionChips";

function ref(
  id: string,
  text: string,
  sourcePath: string | null = "Notes/a.md",
): ChatSelectionRef {
  return { id, text, sourcePath };
}

describe("selection chip labels", () => {
  it("collapses whitespace and ellipsizes long text", () => {
    expect(selectionChipLabel("  hello\n  world  ")).toBe("hello world");
    expect(
      selectionChipLabel("The quick brown fox jumps over the lazy dog"),
    ).toBe("The quick brown fox jumps…");
  });

  it("falls back for whitespace-only selections", () => {
    expect(selectionChipLabel("   \n ")).toBe("Selection…");
  });
});

describe("selection markers", () => {
  it("extracts ids in order without duplicates", () => {
    const draft = `a ${wrapSelectionMarker("x1")} b ${wrapSelectionMarker("x2")} ${wrapSelectionMarker("x1")}`;
    expect(extractSelectionIds(draft)).toEqual(["x1", "x2"]);
  });

  it("expands a marker into a quoted block naming the source", () => {
    const draft = `look at ${wrapSelectionMarker("x1")} please`;
    expect(expandSelectionMarkers(draft, { x1: ref("x1", "one\ntwo") })).toBe(
      ["look at", "", "Selection from Notes/a.md:", "> one", "> two", "", "please"].join(
        "\n",
      ),
    );
  });

  it("omits the source when the selection has no file", () => {
    const draft = wrapSelectionMarker("x1");
    expect(
      expandSelectionMarkers(draft, { x1: ref("x1", "hi", null) }),
    ).toBe("Selection:\n> hi");
  });

  it("drops markers with no known text", () => {
    expect(expandSelectionMarkers(`a ${wrapSelectionMarker("gone")} b`, {})).toBe(
      "a  b",
    );
  });
});

describe("user text segments", () => {
  it("folds an expanded selection back into a chip segment", () => {
    const text = expandSelectionMarkers(`look at ${wrapSelectionMarker("x1")} ok`, {
      x1: ref("x1", "one\ntwo"),
    });
    expect(parseUserTextSegments(text)).toEqual([
      { kind: "text", text: "look at" },
      { kind: "selection", text: "one\ntwo", sourcePath: "Notes/a.md" },
      { kind: "text", text: "ok" },
    ]);
  });

  it("round-trips blank lines and nested quotes", () => {
    const selection = "first\n\n> quoted\nlast";
    const text = expandSelectionMarkers(wrapSelectionMarker("x1"), {
      x1: ref("x1", selection),
    });
    expect(parseUserTextSegments(text)).toEqual([
      { kind: "selection", text: selection, sourcePath: "Notes/a.md" },
    ]);
  });

  it("leaves plain messages untouched", () => {
    expect(parseUserTextSegments("just a question")).toEqual([
      { kind: "text", text: "just a question" },
    ]);
  });

  it("folds vault path markers into path chips", () => {
    expect(parseUserTextSegments("see ⟦Notes/todo.md⟧ and ⟦Projects/⟧")).toEqual([
      { kind: "text", text: "see " },
      { kind: "path", path: "Notes/todo.md" },
      { kind: "text", text: " and " },
      { kind: "path", path: "Projects/" },
    ]);
  });
});

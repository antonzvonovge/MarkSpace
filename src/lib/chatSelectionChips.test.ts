import { describe, expect, it } from "vitest";
import {
  commentChipLabel,
  expandSelectionMarkers,
  extractSelectionIds,
  formatSelectionBlock,
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

function commentRef(
  id: string,
  quote: string,
  body: string,
  sourcePath: string | null = "Notes/a.md",
): ChatSelectionRef {
  return { id, kind: "comment", text: body, quote, sourcePath };
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

describe("comment chip labels", () => {
  it("prefers body over quote", () => {
    expect(commentChipLabel({ text: "fix this", quote: "long quote" })).toBe(
      "fix this",
    );
  });

  it("falls back to quote then Comment…", () => {
    expect(commentChipLabel({ text: "", quote: "quoted span" })).toBe(
      "quoted span",
    );
    expect(commentChipLabel({ text: "  ", quote: "  " })).toBe("Comment…");
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

  it("expands a comment chip with path, quote, and body", () => {
    const draft = wrapSelectionMarker("c1");
    expect(
      expandSelectionMarkers(draft, {
        c1: commentRef("c1", "quoted", "please fix"),
      }),
    ).toBe(
      [
        "Comment from Notes/a.md:",
        "Quote:",
        "> quoted",
        "Body:",
        "> please fix",
      ].join("\n"),
    );
  });
});

describe("formatSelectionBlock", () => {
  it("keeps quote-only comments usable", () => {
    expect(
      formatSelectionBlock(commentRef("c1", "only quote", "", "Proj/n.md")),
    ).toBe("Comment from Proj/n.md:\nQuote:\n> only quote");
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

  it("folds an expanded comment back into a comment segment", () => {
    const text = expandSelectionMarkers(wrapSelectionMarker("c1"), {
      c1: commentRef("c1", "span text", "needs work"),
    });
    expect(parseUserTextSegments(text)).toEqual([
      {
        kind: "comment",
        quote: "span text",
        text: "needs work",
        sourcePath: "Notes/a.md",
      },
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

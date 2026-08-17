import { Node, Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import {
  clampFindIndex,
  collectFindRanges,
  findExactMatches,
  pickFindIndex,
} from "./documentFind";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    strong: {},
  },
});

function para(...inline: Node[]): Node {
  return schema.node("paragraph", null, inline);
}

function doc(...blocks: Node[]): Node {
  return schema.node("doc", null, blocks);
}

describe("findExactMatches", () => {
  it("returns nothing for an empty query", () => {
    expect(findExactMatches("hello", "", false)).toEqual([]);
  });

  it("finds a single literal occurrence", () => {
    expect(findExactMatches("hello world", "world", true)).toEqual([
      { from: 6, to: 11 },
    ]);
  });

  it("finds non-overlapping repeats", () => {
    expect(findExactMatches("aaaa", "aa", true)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("is case-insensitive unless matchCase is set", () => {
    expect(findExactMatches("Hello HELLO hello", "hello", false)).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ]);
    expect(findExactMatches("Hello HELLO hello", "hello", true)).toEqual([
      { from: 12, to: 17 },
    ]);
  });

  it("does not treat the query as a regex", () => {
    expect(findExactMatches("a.b aab", "a.b", true)).toEqual([{ from: 0, to: 3 }]);
  });
});

describe("clampFindIndex / pickFindIndex", () => {
  it("clamps to the last valid index", () => {
    expect(clampFindIndex(0, 0)).toBe(-1);
    expect(clampFindIndex(4, 3)).toBe(2);
    expect(clampFindIndex(-1, 3)).toBe(0);
  });

  it("keeps the previous index unless preferCaret", () => {
    const ranges = [
      { from: 0, to: 1 },
      { from: 10, to: 11 },
    ];
    expect(pickFindIndex(ranges, 10, 0, false)).toBe(0);
    expect(pickFindIndex(ranges, 10, 0, true)).toBe(1);
    expect(pickFindIndex(ranges, 20, 0, true)).toBe(0);
  });
});

describe("collectFindRanges", () => {
  it("finds a match split across marks in one block", () => {
    const d = doc(
      para(
        schema.text("hel"),
        schema.text("lo", [schema.mark("strong")]),
        schema.text(" there"),
      ),
    );
    expect(collectFindRanges(d, "hello", true)).toEqual([{ from: 1, to: 6 }]);
  });

  it("does not join adjacent blocks", () => {
    const d = doc(para(schema.text("end")), para(schema.text("start")));
    expect(collectFindRanges(d, "endstart", true)).toEqual([]);
    expect(collectFindRanges(d, "end", true)).toHaveLength(1);
    expect(collectFindRanges(d, "start", true)).toHaveLength(1);
  });

  it("finds the same word in two paragraphs", () => {
    const d = doc(para(schema.text("hello")), para(schema.text("hello")));
    const hits = collectFindRanges(d, "hello", true);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.from).toBeLessThan(hits[1]!.from);
  });
});

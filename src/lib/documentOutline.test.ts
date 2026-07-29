import { describe, expect, it } from "vitest";
import {
  buildDocumentOutline,
  buildOutlineTree,
  collectExpandableKeys,
  collectOutlineHeadings,
  inlineContentText,
  makeOutlineKey,
} from "./documentOutline";

describe("documentOutline", () => {
  it("flattens text and link inline content", () => {
    expect(
      inlineContentText([
        { type: "text", text: "Hello " },
        { type: "link", content: [{ type: "text", text: "world" }] },
      ]),
    ).toBe("Hello world");
  });

  it("collects headings up to level 3 in document order", () => {
    const headings = collectOutlineHeadings([
      {
        id: "h1",
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "One" }],
      },
      {
        type: "paragraph",
        children: [
          {
            id: "h3-nested",
            type: "heading",
            props: { level: 3 },
            content: [{ type: "text", text: "Nested" }],
          },
        ],
      },
      {
        id: "h4",
        type: "heading",
        props: { level: 4 },
        content: [{ type: "text", text: "Skip" }],
      },
      {
        id: "h2",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Two" }],
      },
    ]);

    expect(headings).toEqual([
      { id: "h1", level: 1, text: "One" },
      { id: "h3-nested", level: 3, text: "Nested" },
      { id: "h2", level: 2, text: "Two" },
    ]);
  });

  it("nests headings into a tree with stable keys", () => {
    const tree = buildOutlineTree([
      { id: "a", level: 1, text: "A" },
      { id: "b", level: 2, text: "B" },
      { id: "c", level: 3, text: "C" },
      { id: "d", level: 2, text: "D" },
      { id: "e", level: 1, text: "E" },
    ]);

    expect(tree).toEqual([
      {
        id: "a",
        key: "1:A",
        level: 1,
        text: "A",
        children: [
          {
            id: "b",
            key: "2:B",
            level: 2,
            text: "B",
            children: [
              { id: "c", key: "3:C", level: 3, text: "C", children: [] },
            ],
          },
          { id: "d", key: "2:D", level: 2, text: "D", children: [] },
        ],
      },
      { id: "e", key: "1:E", level: 1, text: "E", children: [] },
    ]);
  });

  it("disambiguates duplicate heading titles", () => {
    const seen = new Map<string, number>();
    expect(makeOutlineKey(1, "Same", seen)).toBe("1:Same");
    expect(makeOutlineKey(1, "Same", seen)).toBe("1:Same#1");
  });

  it("uses Untitled for empty heading text", () => {
    expect(
      buildDocumentOutline([
        {
          id: "empty",
          type: "heading",
          props: { level: 1 },
          content: [],
        },
      ]),
    ).toEqual([
      { id: "empty", key: "1:Untitled", level: 1, text: "Untitled", children: [] },
    ]);
  });

  it("collects expandable node keys", () => {
    const tree = buildOutlineTree([
      { id: "a", level: 1, text: "A" },
      { id: "b", level: 2, text: "B" },
      { id: "c", level: 3, text: "C" },
      { id: "d", level: 1, text: "D" },
    ]);
    expect(collectExpandableKeys(tree)).toEqual(["1:A", "2:B"]);
  });
});

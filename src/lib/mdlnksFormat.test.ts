import { describe, expect, it } from "vitest";
import {
  EMPTY_MDLNKS,
  MDLNKS_HEADER,
  collectMdlnksTags,
  filterMdlnksItems,
  parseMdlnks,
  serializeMdlnks,
} from "./mdlnksFormat";

describe("mdlnksFormat", () => {
  it("parses empty document", () => {
    const doc = parseMdlnks(EMPTY_MDLNKS);
    expect(doc).toEqual({ filter: [], items: [] });
  });

  it("round-trips filter and items", () => {
    const src = `${MDLNKS_HEADER}
filter: ai, reading

https://example.com
description: Short what this is
tags: ai, reading

https://other.com
description: Another
tags: work
`;
    const doc = parseMdlnks(src);
    expect(doc.filter).toEqual(["ai", "reading"]);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toEqual({
      url: "https://example.com",
      description: "Short what this is",
      tags: ["ai", "reading"],
    });
    const again = parseMdlnks(serializeMdlnks(doc));
    expect(again).toEqual(doc);
  });

  it("allows items without description or tags", () => {
    const doc = parseMdlnks(`${MDLNKS_HEADER}

https://a.com

https://b.com
tags: x
`);
    expect(doc.items).toEqual([
      { url: "https://a.com", description: "", tags: [] },
      { url: "https://b.com", description: "", tags: ["x"] },
    ]);
  });

  it("filters with AND semantics", () => {
    const items = [
      { url: "https://a", description: "", tags: ["ai", "reading"] },
      { url: "https://b", description: "", tags: ["ai"] },
      { url: "https://c", description: "", tags: ["reading"] },
    ];
    expect(filterMdlnksItems(items, []).map((i) => i.url)).toEqual([
      "https://a",
      "https://b",
      "https://c",
    ]);
    expect(filterMdlnksItems(items, ["ai"]).map((i) => i.url)).toEqual([
      "https://a",
      "https://b",
    ]);
    expect(filterMdlnksItems(items, ["ai", "reading"]).map((i) => i.url)).toEqual([
      "https://a",
    ]);
  });

  it("collects unique tags", () => {
    expect(
      collectMdlnksTags([
        { url: "a", description: "", tags: ["AI", "work"] },
        { url: "b", description: "", tags: ["ai", "reading"] },
      ]),
    ).toEqual(["AI", "work", "reading"]);
  });

  it("rejects bad header", () => {
    expect(() => parseMdlnks("# wrong\n")).toThrow(/header/i);
  });
});

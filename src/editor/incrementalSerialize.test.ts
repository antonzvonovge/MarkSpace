import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { nestedHtmlToMarkdown } from "../lib/nestedListMarkdown";
import { noteEditorSchema, type NoteEditor } from "./schema";
import {
  SegmentMarkdownCache,
  joinSegments,
  recordSegmentChanges,
  splitIntoSegments,
} from "./incrementalSerialize";

let editor: NoteEditor | null = null;

function withBlocks(blocks: unknown[]): NoteEditor {
  const next = BlockNoteEditor.create({ schema: noteEditorSchema });
  next.replaceBlocks(next.document, blocks as never);
  editor = next;
  return next;
}

afterEach(() => {
  editor?._tiptapEditor.destroy();
  editor = null;
});

type Block = { id: string; type: string; children?: Block[] };

function serializeWhole(ed: NoteEditor): string {
  return nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document));
}

function serializeBySegments(ed: NoteEditor): string {
  const cache = new SegmentMarkdownCache<Block>();
  return cache.serialize(ed.document as unknown as Block[], (blocks) =>
    nestedHtmlToMarkdown(
      ed.blocksToHTMLLossy(blocks as unknown as typeof ed.document),
    ),
  );
}

/** The whole premise: rebuilding piecewise must produce identical markdown. */
function expectSegmentsMatchWhole(blocks: unknown[]) {
  const ed = withBlocks(blocks);
  expect(serializeBySegments(ed)).toBe(serializeWhole(ed));
}

describe("splitIntoSegments", () => {
  it("gives every standalone block its own segment", () => {
    const segments = splitIntoSegments([
      { id: "a", type: "paragraph" },
      { id: "b", type: "heading" },
    ]);
    expect(segments.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("keeps a run of same-type list items together", () => {
    const segments = splitIntoSegments([
      { id: "a", type: "paragraph" },
      { id: "b", type: "numberedListItem" },
      { id: "c", type: "numberedListItem" },
      { id: "d", type: "numberedListItem" },
      { id: "e", type: "paragraph" },
    ]);
    expect(segments.map((s) => s.key)).toEqual(["a", "b|c|d", "e"]);
  });

  it("splits where the list type changes", () => {
    const segments = splitIntoSegments([
      { id: "a", type: "bulletListItem" },
      { id: "b", type: "numberedListItem" },
      { id: "c", type: "numberedListItem" },
    ]);
    expect(segments.map((s) => s.key)).toEqual(["a", "b|c"]);
  });

  it("changes the key when a list gains an item", () => {
    const before = splitIntoSegments([
      { id: "a", type: "bulletListItem" },
      { id: "b", type: "bulletListItem" },
    ]);
    const after = splitIntoSegments([
      { id: "a", type: "bulletListItem" },
      { id: "x", type: "bulletListItem" },
      { id: "b", type: "bulletListItem" },
    ]);
    expect(before[0].key).not.toBe(after[0].key);
  });
});

describe("joinSegments", () => {
  it("separates segments with one blank line", () => {
    expect(joinSegments(["a\n", "b\n"])).toBe("a\n\nb\n");
  });

  it("drops empty segments instead of leaving gaps", () => {
    expect(joinSegments(["a\n", "\n", "b\n"])).toBe("a\n\nb\n");
  });

  it("returns a bare newline for an empty document", () => {
    expect(joinSegments([])).toBe("\n");
  });
});

describe("segment output matches a whole-document export", () => {
  it("paragraphs and headings", () => {
    expectSegmentsMatchWhole([
      { type: "heading", props: { level: 1 }, content: "Title" },
      { type: "paragraph", content: "First paragraph." },
      { type: "paragraph", content: "Second paragraph." },
    ]);
  });

  it("a numbered list keeps its numbering", () => {
    expectSegmentsMatchWhole([
      { type: "paragraph", content: "Before" },
      { type: "numberedListItem", content: "one" },
      { type: "numberedListItem", content: "two" },
      { type: "numberedListItem", content: "three" },
      { type: "paragraph", content: "After" },
    ]);
  });

  it("nested bullet lists", () => {
    expectSegmentsMatchWhole([
      {
        type: "bulletListItem",
        content: "Parent",
        children: [
          { type: "bulletListItem", content: "Child" },
          { type: "bulletListItem", content: "Sibling" },
        ],
      },
      { type: "bulletListItem", content: "Second parent" },
    ]);
  });

  it("adjacent lists of different types", () => {
    expectSegmentsMatchWhole([
      { type: "bulletListItem", content: "bullet one" },
      { type: "bulletListItem", content: "bullet two" },
      { type: "numberedListItem", content: "number one" },
      { type: "numberedListItem", content: "number two" },
    ]);
  });

  it("check list items", () => {
    expectSegmentsMatchWhole([
      { type: "checkListItem", props: { checked: true }, content: "done" },
      { type: "checkListItem", props: { checked: false }, content: "todo" },
    ]);
  });

  it("code blocks", () => {
    expectSegmentsMatchWhole([
      { type: "paragraph", content: "Before" },
      {
        type: "codeBlock",
        props: { language: "typescript" },
        content: "const x = 1;",
      },
      { type: "paragraph", content: "After" },
    ]);
  });

  it("inline styles and links", () => {
    expectSegmentsMatchWhole([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", styles: { bold: true } },
          { type: "text", text: " and ", styles: {} },
          { type: "text", text: "italic", styles: { italic: true } },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "link",
            href: "https://example.com",
            content: "a link",
          },
        ],
      },
    ]);
  });

  it("a list broken up by a paragraph", () => {
    expectSegmentsMatchWhole([
      { type: "numberedListItem", content: "one" },
      { type: "paragraph", content: "interruption" },
      { type: "numberedListItem", content: "restarts" },
    ]);
  });

  it("tables and quotes", () => {
    expectSegmentsMatchWhole([
      { type: "quote", content: "A quoted line." },
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: ["a", "b"] },
            { cells: ["c", "d"] },
          ],
        },
      },
      { type: "paragraph", content: "After the table" },
    ]);
  });

  it("custom diagram and equation blocks", () => {
    expectSegmentsMatchWhole([
      { type: "paragraph", content: "Before" },
      { type: "mermaid", props: { code: "graph TD; A-->B;" } },
      { type: "equation", props: { code: "x^2 + y^2 = z^2" } },
      { type: "paragraph", content: "After" },
    ]);
  });

  it("a long mixed document", () => {
    const blocks: unknown[] = [];
    for (let i = 0; i < 30; i++) {
      blocks.push({
        type: "heading",
        props: { level: 2 },
        content: `Section ${i}`,
      });
      blocks.push({ type: "paragraph", content: `Body text for ${i}.` });
      blocks.push({ type: "bulletListItem", content: `point a ${i}` });
      blocks.push({ type: "bulletListItem", content: `point b ${i}` });
    }
    expectSegmentsMatchWhole(blocks);
  });
});

describe("SegmentMarkdownCache reuse", () => {
  const blocks: Block[] = [
    { id: "a", type: "paragraph" },
    { id: "b", type: "paragraph" },
    { id: "c", type: "paragraph" },
  ];

  it("serializes everything on the first pass", () => {
    const cache = new SegmentMarkdownCache<Block>();
    const seen: string[] = [];
    cache.serialize(blocks, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("only rebuilds the segments reported as changed", () => {
    const cache = new SegmentMarkdownCache<Block>();
    cache.serialize(blocks, (bs) => `${bs[0].id}\n`);

    const seen: string[] = [];
    cache.markDirty(["b"]);
    const out = cache.serialize(blocks, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}!\n`;
    });
    expect(seen).toEqual(["b"]);
    expect(out).toBe("a\n\nb!\n\nc\n");
  });

  it("rebuilds everything after invalidateAll", () => {
    const cache = new SegmentMarkdownCache<Block>();
    cache.serialize(blocks, (bs) => `${bs[0].id}\n`);
    cache.invalidateAll();

    const seen: string[] = [];
    cache.serialize(blocks, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("serializes a newly inserted block without touching its neighbours", () => {
    const cache = new SegmentMarkdownCache<Block>();
    cache.serialize(blocks, (bs) => `${bs[0].id}\n`);

    const seen: string[] = [];
    const withInsert: Block[] = [
      blocks[0],
      { id: "new", type: "paragraph" },
      blocks[1],
      blocks[2],
    ];
    cache.markDirty(["new"]);
    const out = cache.serialize(withInsert, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    expect(seen).toEqual(["new"]);
    expect(out).toBe("a\n\nnew\n\nb\n\nc\n");
  });

  it("forgets deleted segments instead of growing forever", () => {
    const cache = new SegmentMarkdownCache<Block>();
    cache.serialize(blocks, (bs) => `${bs[0].id}\n`);
    cache.serialize([blocks[0]], (bs) => `${bs[0].id}\n`);

    const seen: string[] = [];
    cache.serialize(blocks, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    expect(seen).toEqual(["b", "c"]);
  });

  it("rebuilds a segment when one of its nested children changes", () => {
    const cache = new SegmentMarkdownCache<Block>();
    const nested: Block[] = [
      { id: "a", type: "paragraph" },
      {
        id: "b",
        type: "bulletListItem",
        children: [{ id: "b-child", type: "paragraph" }],
      },
    ];
    cache.serialize(nested, (bs) => `${bs[0].id}\n`);

    const seen: string[] = [];
    cache.markDirty(["b-child"]);
    cache.serialize(nested, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    expect(seen).toEqual(["b"]);
  });

  it("rebuilds a whole list run when one of its items changes", () => {
    const cache = new SegmentMarkdownCache<Block>();
    const listBlocks: Block[] = [
      { id: "p", type: "paragraph" },
      { id: "l1", type: "numberedListItem" },
      { id: "l2", type: "numberedListItem" },
    ];
    cache.serialize(listBlocks, (bs) => `${bs.map((b) => b.id).join(",")}\n`);

    const seen: string[][] = [];
    cache.markDirty(["l2"]);
    cache.serialize(listBlocks, (bs) => {
      seen.push(bs.map((b) => b.id));
      return `${bs.map((b) => b.id).join(",")}\n`;
    });
    expect(seen).toEqual([["l1", "l2"]]);
  });
});

describe("recordSegmentChanges", () => {
  const blocks: Block[] = [
    { id: "a", type: "paragraph" },
    { id: "b", type: "paragraph" },
  ];

  function warmCache() {
    const cache = new SegmentMarkdownCache<Block>();
    cache.serialize(blocks, (bs) => `${bs[0].id}\n`);
    return cache;
  }

  function rebuiltIds(cache: SegmentMarkdownCache<Block>): string[] {
    const seen: string[] = [];
    cache.serialize(blocks, (bs) => {
      seen.push(bs[0].id);
      return `${bs[0].id}\n`;
    });
    return seen;
  }

  it("marks only the reported blocks dirty for a local edit", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        { type: "update", source: { type: "local" }, block: { id: "b" } },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["b"]);
  });

  it("drops the cache on paste", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        { type: "insert", source: { type: "paste" }, block: { id: "b" } },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache on undo", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        { type: "update", source: { type: "undo-redo" }, block: { id: "b" } },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache on a remote edit", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        { type: "update", source: { type: "yjs-remote" }, block: { id: "b" } },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache when a block moves", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        { type: "move", source: { type: "local" }, block: { id: "b" } },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache when a change reports no blocks", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, { getChanges: () => [] });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache when getChanges throws", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => {
        throw new Error("no transaction");
      },
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("drops the cache when no context is supplied", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, undefined);
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });

  it("marks the previous block dirty too on an update", () => {
    const cache = warmCache();
    recordSegmentChanges(cache, {
      getChanges: () => [
        {
          type: "update",
          source: { type: "local" },
          block: { id: "a" },
          prevBlock: { id: "b" },
        },
      ],
    });
    expect(rebuiltIds(cache)).toEqual(["a", "b"]);
  });
});

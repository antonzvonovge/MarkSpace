import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { nestedHtmlToMarkdown } from "../lib/nestedListMarkdown";
import { noteEditorSchema, type NoteEditor } from "./schema";
import {
  recordSegmentChanges,
  SegmentMarkdownCache,
  type SegmentBlock,
} from "./incrementalSerialize";

/**
 * The integration the unit tests cannot cover: real `onChange` transactions
 * feeding `getChanges()` into the cache, checked against a whole-document
 * export after every edit.
 */

let editor: NoteEditor | null = null;
let unsubscribe: (() => void) | null = null;

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  editor?._tiptapEditor.destroy();
  editor = null;
});

function setup(initial: unknown[]) {
  const ed = BlockNoteEditor.create({ schema: noteEditorSchema });
  editor = ed;
  ed.replaceBlocks(ed.document, initial as never);

  const cache = new SegmentMarkdownCache<SegmentBlock>();
  unsubscribe = ed.onChange((_editor, context) => {
    recordSegmentChanges(cache, context);
  });

  let rebuilt = 0;
  const serializeSegment = (blocks: SegmentBlock[]) => {
    rebuilt += 1;
    return nestedHtmlToMarkdown(
      ed.blocksToHTMLLossy(blocks as unknown as typeof ed.document),
    );
  };

  const incremental = () =>
    cache.serialize(ed.document as unknown as SegmentBlock[], serializeSegment);
  const whole = () => nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document));

  /** Returns how many segments had to be rebuilt for this pass. */
  const check = (what: string) => {
    rebuilt = 0;
    expect(incremental(), what).toBe(whole());
    return rebuilt;
  };

  // Prime the cache the way the editor does after loading a note.
  check("initial load");
  return { ed, check };
}

const doc = [
  { type: "heading", props: { level: 1 }, content: "Notes" },
  { type: "paragraph", content: "Intro paragraph." },
  { type: "bulletListItem", content: "alpha" },
  { type: "bulletListItem", content: "beta" },
  { type: "paragraph", content: "Outro paragraph." },
];

describe("incremental serialization against live editor changes", () => {
  it("rebuilds only the edited paragraph", () => {
    const { ed, check } = setup(doc);
    ed.updateBlock(ed.document[1], { content: "Intro paragraph, edited." });
    expect(check("after paragraph edit")).toBe(1);
    expect(incrementalOutput(ed)).toContain("Intro paragraph, edited.");
  });

  it("rebuilds only the list a changed item belongs to", () => {
    const { ed, check } = setup(doc);
    ed.updateBlock(ed.document[3], { content: "beta edited" });
    expect(check("after list item edit")).toBe(1);
  });

  it("survives inserting a block between segments", () => {
    const { ed, check } = setup(doc);
    ed.insertBlocks(
      [{ type: "paragraph", content: "Inserted." }] as never,
      ed.document[1],
      "after",
    );
    check("after insert");
  });

  it("survives inserting an item into an existing list", () => {
    const { ed, check } = setup(doc);
    ed.insertBlocks(
      [{ type: "bulletListItem", content: "between" }] as never,
      ed.document[2],
      "after",
    );
    check("after list insert");
  });

  it("survives removing a block", () => {
    const { ed, check } = setup(doc);
    ed.removeBlocks([ed.document[1]]);
    check("after remove");
  });

  it("survives removing an entire list", () => {
    const { ed, check } = setup(doc);
    ed.removeBlocks([ed.document[2], ed.document[3]]);
    check("after list removal");
  });

  it("survives converting a paragraph into a list item", () => {
    const { ed, check } = setup(doc);
    ed.updateBlock(ed.document[4], { type: "bulletListItem" } as never);
    check("after type change");
  });

  it("survives nesting a list item", () => {
    const { ed, check } = setup(doc);
    ed.updateBlock(ed.document[2], {
      children: [{ type: "bulletListItem", content: "nested" }],
    } as never);
    check("after nesting");
  });

  it("survives editing a nested child", () => {
    const { ed, check } = setup([
      { type: "paragraph", content: "Top" },
      {
        type: "bulletListItem",
        content: "parent",
        children: [{ type: "bulletListItem", content: "child" }],
      },
    ]);
    const parent = ed.document[1];
    ed.updateBlock(parent.children[0], { content: "child edited" } as never);
    check("after nested edit");
  });

  it("survives a replaceBlocks rewrite", () => {
    const { ed, check } = setup(doc);
    ed.replaceBlocks(ed.document, [
      { type: "paragraph", content: "Completely different." },
      { type: "numberedListItem", content: "one" },
      { type: "numberedListItem", content: "two" },
    ] as never);
    check("after replaceBlocks");
  });

  it("survives a long run of successive edits", () => {
    const { ed, check } = setup(doc);
    for (let i = 0; i < 15; i++) {
      ed.updateBlock(ed.document[1], { content: `Intro rev ${i}.` });
      ed.insertBlocks(
        [{ type: "bulletListItem", content: `extra ${i}` }] as never,
        ed.document[3],
        "after",
      );
      // The paragraph and the growing list, never the untouched heading or outro.
      expect(check(`after round ${i}`)).toBeLessThanOrEqual(2);
    }
  });
});

function incrementalOutput(ed: NoteEditor): string {
  return nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document));
}

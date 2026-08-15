import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, describe, expect, it } from "vitest";
import { noteEditorSchema, type NoteEditor } from "../editor/schema";
import {
  markdownToNestedBlocks,
  nestedHtmlToMarkdown,
  renestListChildren,
} from "./nestedListMarkdown";
import { normalizeMarkdown } from "./normalizeMarkdown";

let editor: NoteEditor | null = null;

function withBlocks(blocks: unknown[]): NoteEditor {
  const next = BlockNoteEditor.create({ schema: noteEditorSchema });
  next.replaceBlocks(next.document, blocks as never);
  editor = next;
  return next;
}

/** Live save pipeline: blocks → external HTML → markdown → what lands on disk. */
function saved(blocks: unknown[]): string {
  const ed = withBlocks(blocks);
  return normalizeMarkdown(
    nestedHtmlToMarkdown(ed.blocksToHTMLLossy(ed.document)),
  );
}

type Shape = { type: string; children?: Shape[] };

function reloaded(markdown: string): Shape[] {
  const ed = editor!;
  const shape = (blocks: { type: string; children?: unknown[] }[]): Shape[] =>
    blocks.map((block) => ({
      type: block.type,
      ...(block.children?.length
        ? {
            children: shape(
              block.children as { type: string; children?: unknown[] }[],
            ),
          }
        : {}),
    }));
  return shape(markdownToNestedBlocks(ed, markdown));
}

afterEach(() => {
  editor?._tiptapEditor.destroy();
  editor = null;
});

describe("Tab-indented content inside list items", () => {
  it("keeps a continuation paragraph under the last item", () => {
    const markdown = saved([
      { type: "bulletListItem", content: "First" },
      {
        type: "bulletListItem",
        content: "Last",
        children: [{ type: "paragraph", content: "Indented under last" }],
      },
    ]);

    expect(markdown).toBe("* First\n* Last\n\n  Indented under last\n");
    expect(reloaded(markdown)).toEqual([
      { type: "bulletListItem" },
      {
        type: "bulletListItem",
        children: [{ type: "paragraph" }],
      },
    ]);
  });

  it("keeps numbering when an item has an indented body", () => {
    const markdown = saved([
      {
        type: "numberedListItem",
        content: "First step",
        children: [{ type: "paragraph", content: "Body of the first step" }],
      },
      { type: "numberedListItem", content: "Second step" },
    ]);

    expect(markdown).toBe(
      "1. First step\n\n   Body of the first step\n2. Second step\n",
    );
    expect(reloaded(markdown)).toEqual([
      {
        type: "numberedListItem",
        children: [{ type: "paragraph" }],
      },
      { type: "numberedListItem" },
    ]);
  });

  it("keeps nested list items nested", () => {
    const markdown = saved([
      {
        type: "bulletListItem",
        content: "Level 1",
        children: [
          {
            type: "bulletListItem",
            content: "Level 2",
            children: [{ type: "paragraph", content: "Body at level 2" }],
          },
        ],
      },
    ]);

    expect(markdown).toBe("* Level 1\n  * Level 2\n\n    Body at level 2\n");
    expect(reloaded(markdown)).toEqual([
      {
        type: "bulletListItem",
        children: [
          {
            type: "bulletListItem",
            children: [{ type: "paragraph" }],
          },
        ],
      },
    ]);
  });

  it("keeps a sub-list that follows a continuation paragraph nested", () => {
    const markdown = saved([
      { type: "numberedListItem", content: "First step" },
      {
        type: "numberedListItem",
        content: "Second step",
        children: [
          { type: "paragraph", content: "Start with a cheap model" },
          { type: "bulletListItem", content: "Fixed in 1-2 tries" },
          { type: "bulletListItem", content: "Escalate after 3 retries" },
        ],
      },
      { type: "numberedListItem", content: "Third step" },
    ]);

    expect(markdown).toBe(
      "1. First step\n" +
        "2. Second step\n\n" +
        "   Start with a cheap model\n" +
        "   * Fixed in 1-2 tries\n" +
        "   * Escalate after 3 retries\n" +
        "3. Third step\n",
    );
    expect(reloaded(markdown)).toEqual([
      { type: "numberedListItem" },
      {
        type: "numberedListItem",
        children: [
          { type: "paragraph" },
          { type: "bulletListItem" },
          { type: "bulletListItem" },
        ],
      },
      { type: "numberedListItem" },
    ]);
  });

  it("keeps a fenced code block inside its item", () => {
    const markdown = saved([
      {
        type: "bulletListItem",
        content: "Run it",
        children: [
          { type: "codeBlock", props: { language: "bash" }, content: "npm test" },
        ],
      },
    ]);

    expect(markdown).toBe("* Run it\n\n  ```bash\n  npm test\n  ```\n");
    expect(reloaded(markdown)).toEqual([
      {
        type: "bulletListItem",
        children: [{ type: "codeBlock" }],
      },
    ]);
  });

  it("leaves a top-level code fence untouched", () => {
    const markdown = saved([
      { type: "codeBlock", props: { language: "bash" }, content: "npm test" },
    ]);

    expect(markdown).toBe("```bash\nnpm test\n```\n");
  });

  it("leaves a paragraph that follows a list at the margin", () => {
    const markdown = saved([
      { type: "bulletListItem", content: "Item" },
      { type: "paragraph", content: "Plain paragraph after the list" },
    ]);

    expect(markdown).toBe("* Item\n\nPlain paragraph after the list\n");
    expect(reloaded(markdown)).toEqual([
      { type: "bulletListItem" },
      { type: "paragraph" },
    ]);
  });

  it("leaves nesting that markdown cannot express flat", () => {
    const markdown = saved([
      {
        type: "heading",
        content: "Section",
        children: [{ type: "paragraph", content: "Nested under heading" }],
      },
    ]);

    expect(markdown).toBe("# Section\n\nNested under heading\n");
  });
});

describe("renesting skipped when nothing can move", () => {
  const exportHtml = (blocks: unknown[]): string => {
    const ed = withBlocks(blocks);
    return ed.blocksToHTMLLossy(ed.document);
  };

  it("hands back flat markup verbatim, skipping parse and re-serialize", () => {
    const html = exportHtml([
      { type: "heading", content: "Title" },
      { type: "paragraph", content: "Plain prose" },
      { type: "bulletListItem", content: "One" },
      { type: "bulletListItem", content: "Two" },
    ]);

    expect(html).not.toContain("data-nesting-level");
    expect(renestListChildren(html)).toBe(html);
  });

  it("still renests a block the exporter lifted out of its item", () => {
    const html = exportHtml([
      {
        type: "bulletListItem",
        content: "Item",
        children: [{ type: "paragraph", content: "Continuation" }],
      },
      { type: "bulletListItem", content: "Next" },
    ]);

    expect(html).toContain("data-nesting-level");
    expect(renestListChildren(html)).not.toBe(html);
  });
});

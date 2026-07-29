import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyColoredTableHtml,
  collectTableBlocks,
  extractTableHtml,
  findGfmTableRanges,
  projectColoredTables,
  tableHasCellColors,
} from "./tableMarkdown";

describe("table cell color round-trip (BlockNote)", () => {
  let editor: BlockNoteEditor;

  beforeEach(() => {
    editor = BlockNoteEditor.create({
      tables: { cellBackgroundColor: true, cellTextColor: true },
    });
  });

  afterEach(() => {
    editor._tiptapEditor.destroy();
  });

  it("persists colors through markdown HTML projection", () => {
    editor.replaceBlocks(editor.document, [
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  content: [{ type: "text", text: "Red", styles: {} }],
                  props: {
                    backgroundColor: "red",
                    textColor: "default",
                    textAlignment: "left",
                    colspan: 1,
                    rowspan: 1,
                  },
                },
                {
                  type: "tableCell",
                  content: [{ type: "text", text: "Ok", styles: { bold: true } }],
                  props: {
                    backgroundColor: "default",
                    textColor: "blue",
                    textAlignment: "center",
                    colspan: 1,
                    rowspan: 1,
                  },
                },
              ],
            },
          ],
        },
      },
    ]);

    expect(tableHasCellColors(editor.document[0]!)).toBe(true);

    const lossy = editor.blocksToMarkdownLossy();
    expect(lossy).not.toContain("data-background-color");

    const md = applyColoredTableHtml(
      lossy,
      projectColoredTables(editor.document, (blocks) =>
        editor.blocksToHTMLLossy(blocks as typeof editor.document),
      ),
    );
    expect(md).toContain('data-background-color="red"');
    expect(md).toContain('data-text-color="blue"');

    const parsed = editor.tryParseMarkdownToBlocks(md);
    const cell0 = (parsed[0] as any).content.rows[0].cells[0];
    const cell1 = (parsed[0] as any).content.rows[0].cells[1];
    expect(cell0.props.backgroundColor).toBe("red");
    expect(cell1.props.textColor).toBe("blue");
    expect(cell1.props.textAlignment).toBe("center");
    expect(cell1.content[0].styles.bold).toBe(true);
  });
});

const coloredTableBlock = {
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      {
        cells: [
          {
            type: "tableCell",
            content: [{ type: "text", text: "Red", styles: {} }],
            props: {
              backgroundColor: "red",
              textColor: "default",
              textAlignment: "left",
              colspan: 1,
              rowspan: 1,
            },
          },
          {
            type: "tableCell",
            content: [{ type: "text", text: "Ok", styles: { bold: true } }],
            props: {
              backgroundColor: "default",
              textColor: "blue",
              textAlignment: "center",
              colspan: 1,
              rowspan: 1,
            },
          },
        ],
      },
    ],
  },
  children: [],
};

const plainTableBlock = {
  type: "table",
  content: {
    type: "tableContent",
    rows: [
      {
        cells: [
          {
            type: "tableCell",
            content: [{ type: "text", text: "A", styles: {} }],
            props: {
              backgroundColor: "default",
              textColor: "default",
              textAlignment: "left",
              colspan: 1,
              rowspan: 1,
            },
          },
        ],
      },
    ],
  },
  children: [],
};

describe("tableMarkdown", () => {
  it("detects cell colors on table blocks", () => {
    expect(tableHasCellColors(coloredTableBlock)).toBe(true);
    expect(tableHasCellColors(plainTableBlock)).toBe(false);
  });

  it("collects nested tables depth-first", () => {
    const tables = collectTableBlocks([
      { type: "paragraph", children: [plainTableBlock] },
      coloredTableBlock,
    ]);
    expect(tables).toHaveLength(2);
    expect(tableHasCellColors(tables[0]!)).toBe(false);
    expect(tableHasCellColors(tables[1]!)).toBe(true);
  });

  it("finds GFM table ranges", () => {
    const md = [
      "Before",
      "",
      "|   |   |",
      "| - | - |",
      "| A | B |",
      "",
      "Mid",
      "",
      "| H |",
      "| - |",
      "| C |",
      "",
      "After",
    ].join("\n");

    const ranges = findGfmTableRanges(md);
    expect(ranges).toHaveLength(2);
    expect(md.slice(ranges[0]!.start, ranges[0]!.end)).toContain("| A | B |");
    expect(md.slice(ranges[1]!.start, ranges[1]!.end)).toContain("| C |");
  });

  it("replaces only colored tables with HTML", () => {
    const md = [
      "|   |",
      "| - |",
      "| A |",
      "",
      "|   |   |",
      "| - | - |",
      "| Red | **Ok** |",
      "",
    ].join("\n");

    const html =
      '<table><tr><td data-background-color="red">Red</td><td data-text-color="blue"><strong>Ok</strong></td></tr></table>';

    const out = applyColoredTableHtml(md, [null, html]);
    expect(out).toContain("| A |");
    expect(out).toContain('data-background-color="red"');
    expect(out).not.toContain("| Red | **Ok** |");
  });

  it("extracts table from BlockNote HTML export", () => {
    const html =
      '<div><table><tr><td data-background-color="red">X</td></tr></table></div>';
    expect(extractTableHtml(html)).toBe(
      '<table><tr><td data-background-color="red">X</td></tr></table>',
    );
  });

  it("projects colored tables via HTML exporter callback", () => {
    const projections = projectColoredTables(
      [plainTableBlock, coloredTableBlock],
      (blocks) => {
        if (blocks[0] === coloredTableBlock) {
          return '<table><tr><td data-background-color="red">Red</td></tr></table>';
        }
        return "<table><tr><td>A</td></tr></table>";
      },
    );
    expect(projections[0]).toBeNull();
    expect(projections[1]).toContain('data-background-color="red"');
  });
});

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type IRunOptions,
  type ParagraphChild,
} from "docx";

type Marks = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
};

const THIN = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const CELL_BORDERS = {
  top: THIN,
  bottom: THIN,
  left: THIN,
  right: THIN,
};

function headingLevel(tag: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] | null {
  switch (tag) {
    case "H1":
      return HeadingLevel.HEADING_1;
    case "H2":
      return HeadingLevel.HEADING_2;
    case "H3":
      return HeadingLevel.HEADING_3;
    case "H4":
      return HeadingLevel.HEADING_4;
    case "H5":
      return HeadingLevel.HEADING_5;
    case "H6":
      return HeadingLevel.HEADING_6;
    default:
      return null;
  }
}

function run(text: string, marks: Marks): TextRun {
  const opts: IRunOptions = { text };
  if (marks.bold) opts.bold = true;
  if (marks.italics) opts.italics = true;
  if (marks.strike) opts.strike = true;
  if (marks.code) {
    opts.font = "Courier New";
    opts.size = 20;
  }
  return new TextRun(opts);
}

function withMark(el: Element, marks: Marks): Marks {
  const tag = el.tagName;
  if (tag === "STRONG" || tag === "B") return { ...marks, bold: true };
  if (tag === "EM" || tag === "I") return { ...marks, italics: true };
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") return { ...marks, strike: true };
  if (tag === "CODE" || tag === "KBD") return { ...marks, code: true };
  return marks;
}

function inlinesFromNode(node: Node, marks: Marks): ParagraphChild[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return [];
    return [run(text, marks)];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName;
  if (tag === "BR") return [new TextRun({ break: 1 })];
  if (tag === "A") {
    const href = el.getAttribute("href")?.trim() ?? "";
    const children = [...el.childNodes].flatMap((c) =>
      inlinesFromNode(c, withMark(el, marks)),
    );
    if (href && /^https?:\/\//i.test(href)) {
      return [
        new ExternalHyperlink({
          children: children.length ? (children as TextRun[]) : [run(href, marks)],
          link: href,
        }),
      ];
    }
    return children;
  }
  return [...el.childNodes].flatMap((c) => inlinesFromNode(c, withMark(el, marks)));
}

function paragraphFromElement(
  el: Element,
  extra?: ConstructorParameters<typeof Paragraph>[0],
): Paragraph {
  const children = [...el.childNodes].flatMap((c) => inlinesFromNode(c, {}));
  return new Paragraph({
    ...extra,
    children: children.length ? children : [new TextRun("")],
  });
}

function listItems(el: Element, ordered: boolean, level: number): Paragraph[] {
  const out: Paragraph[] = [];
  for (const child of [...el.children]) {
    if (child.tagName !== "LI") continue;
    const nested = [...child.children].filter(
      (c) => c.tagName === "UL" || c.tagName === "OL",
    );
    const clone = child.cloneNode(true) as Element;
    for (const n of [...clone.children]) {
      if (n.tagName === "UL" || n.tagName === "OL") n.remove();
    }
    out.push(
      paragraphFromElement(clone, {
        numbering: {
          reference: ordered ? "numbers" : "bullets",
          level: Math.min(level, 8),
        },
      }),
    );
    for (const n of nested) {
      out.push(...listItems(n, n.tagName === "OL", level + 1));
    }
  }
  return out;
}

function tableFromElement(el: Element): Table {
  const rows = [...el.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")];
  const tableRows = (rows.length ? rows : [...el.querySelectorAll("tr")]).map((tr) => {
    const cells = [...tr.children].filter(
      (c) => c.tagName === "TD" || c.tagName === "TH",
    );
    return new TableRow({
      children: cells.map((cell) => {
        return new TableCell({
          borders: CELL_BORDERS,
          width: { size: 20, type: WidthType.PERCENTAGE },
          children: [paragraphFromElement(cell)],
        });
      }),
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows:
      tableRows.length > 0
        ? tableRows
        : [
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph("")],
                }),
              ],
            }),
          ],
  });
}

function blocksFromNode(node: Node): FileChild[] {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    const text = node.textContent?.trim();
    if (!text) return [];
    return [new Paragraph({ children: [run(text, {})] })];
  }
  const el = node as Element;
  const tag = el.tagName;
  const heading = headingLevel(tag);
  if (heading) {
    return [paragraphFromElement(el, { heading })];
  }
  if (tag === "P") return [paragraphFromElement(el)];
  if (tag === "BLOCKQUOTE") {
    return [paragraphFromElement(el, { indent: { left: 720 } })];
  }
  if (tag === "PRE") {
    return [
      paragraphFromElement(el, {
        shading: { fill: "F4F4F4" },
      }),
    ];
  }
  if (tag === "UL") return listItems(el, false, 0);
  if (tag === "OL") return listItems(el, true, 0);
  if (tag === "TABLE") return [tableFromElement(el)];
  if (tag === "HR") return [new Paragraph({ border: { bottom: THIN } })];
  if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE" || tag === "BODY") {
    return [...el.childNodes].flatMap((c) => blocksFromNode(c));
  }
  if (tag === "LI") {
    return [paragraphFromElement(el)];
  }
  const inlines = inlinesFromNode(el, {});
  if (inlines.length === 0) {
    return [...el.childNodes].flatMap((c) => blocksFromNode(c));
  }
  return [new Paragraph({ children: inlines })];
}

export async function htmlToDocxBytes(html: string): Promise<Uint8Array> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const body = parsed.body;
  const children = [...body.childNodes].flatMap((n) => blocksFromNode(n));
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
        {
          reference: "numbers",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 + level * 360, hanging: 360 },
              },
            },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

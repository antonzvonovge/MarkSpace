import { describe, expect, it } from "vitest";
import { EMPTY_DRAWIO_XML } from "../../editor/drawio/constants";
import { mutateDiagram } from "./model";
import {
  compressDiagram,
  extractMxGraphModel,
  listPageMeta,
  mxfilePageIsEmpty,
  mxGraphModelIsEmpty,
  readPageXmlFromText,
  wrapContentAsMxfile,
  writePageXmlInText,
} from "./pages";
import {
  assertPaintedMxfile,
  classifyMermaid,
  elkLayeredLayout,
  EMPTY_PAINT_ERROR,
  mermaidFlowDirection,
  mermaidLoadAction,
  prepareMermaidSource,
  SEQUENCE_WRAP_CONFIG,
} from "./importMermaid";
import {
  assertNotEmptyContentMutate,
  EMPTY_FIRST_PAINT_ERROR,
} from "./tools";

const SAMPLE_MODEL = `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Hello" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`;

describe("drawio page helpers", () => {
  it("lists the empty template page", () => {
    const pages = listPageMeta(EMPTY_DRAWIO_XML);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.name).toBe("Page-1");
    expect(pages[0]!.id).toBe("page-1");
    expect(pages[0]!.index).toBe(0);
  });

  it("treats the empty template as first-paint empty", async () => {
    expect(await mxfilePageIsEmpty(EMPTY_DRAWIO_XML, "0")).toBe(true);
    expect(await mxfilePageIsEmpty(EMPTY_DRAWIO_XML, "Page-1")).toBe(true);
  });

  it("wraps mxGraphModel into an mxfile and extracts it back", () => {
    const mxfile = wrapContentAsMxfile(SAMPLE_MODEL);
    expect(mxfile).toContain("<mxfile");
    expect(extractMxGraphModel(mxfile)).toContain('value="Hello"');
    expect(mxGraphModelIsEmpty(SAMPLE_MODEL)).toBe(false);
  });

  it("rejects a full mxfile as set_page content", async () => {
    await expect(
      writePageXmlInText(EMPTY_DRAWIO_XML, "0", EMPTY_DRAWIO_XML),
    ).rejects.toThrow(/mxGraphModel/);
  });

  it("replaces a page and round-trips uncompressed XML", async () => {
    const written = await writePageXmlInText(
      EMPTY_DRAWIO_XML,
      "0",
      SAMPLE_MODEL,
    );
    expect(written.index).toBe(0);
    expect(await mxfilePageIsEmpty(written.xml, "0")).toBe(false);
    const read = await readPageXmlFromText(written.xml, "Page-1");
    expect(read.xml).toContain('value="Hello"');
  });

  it("round-trips a compressed page", async () => {
    const compressed = await compressDiagram(SAMPLE_MODEL);
    const mxfile = `<mxfile host="MarkSpace"><diagram id="p1" name="P">${compressed}</diagram></mxfile>`;
    const read = await readPageXmlFromText(mxfile, "0");
    expect(read.xml).toContain('value="Hello"');
    const next = await writePageXmlInText(
      mxfile,
      "p1",
      SAMPLE_MODEL.replace("Hello", "World"),
    );
    expect(next.compressed).toBe(true);
    const again = await readPageXmlFromText(next.xml, "0");
    expect(again.xml).toContain('value="World"');
  });

  it("wraps xml first paint into a non-empty mxfile", async () => {
    const painted = wrapContentAsMxfile(SAMPLE_MODEL);
    expect(await mxfilePageIsEmpty(painted, "0")).toBe(false);
  });
});

describe("first-paint emptiness", () => {
  it("rejects the empty template as a successful paint", async () => {
    await expect(assertPaintedMxfile(EMPTY_DRAWIO_XML)).rejects.toThrow(
      EMPTY_PAINT_ERROR,
    );
  });
});

describe("first-paint mutate guard", () => {
  it("rejects add_nodes on an empty page", async () => {
    await expect(
      assertNotEmptyContentMutate(EMPTY_DRAWIO_XML, {
        add_nodes: [{ label: "A" }],
      }),
    ).rejects.toThrow(EMPTY_FIRST_PAINT_ERROR);
  });

  it("allows mutate after the page has vertices", async () => {
    const seeded = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [{ label: "A", x: 10, y: 10 }],
    });
    await expect(
      assertNotEmptyContentMutate(seeded.xml, {
        add_nodes: [{ label: "B" }],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("mermaid embed protocol", () => {
  it("classifies flow vs sequence", () => {
    expect(classifyMermaid("graph TD; A-->B;")).toBe("flow");
    expect(classifyMermaid("flowchart LR\n  A-->B")).toBe("flow");
    expect(classifyMermaid("sequenceDiagram\n  A->>B: hi")).toBe("fixed");
    expect(classifyMermaid("gantt\n  title Plan")).toBe("fixed");
  });

  it("picks ELK direction from flowchart heading", () => {
    expect(mermaidFlowDirection("flowchart LR\nA-->B")).toBe("RIGHT");
    expect(mermaidFlowDirection("graph TD; A-->B;")).toBe("DOWN");
  });

  it("sends ELK layout for flowcharts", () => {
    const action = mermaidLoadAction("graph TD; A-->B;");
    expect(action.action).toBe("load");
    const descriptor = action.descriptor as { format: string; data: string };
    expect(descriptor.format).toBe("mermaid");
    expect(descriptor.data).toContain("defaultRenderer");
    expect(descriptor.data).toContain("graph TD; A-->B;");
    expect(action.layout).toEqual(elkLayeredLayout("DOWN"));
  });

  it("injects mermaid-elk for flowcharts even without the embed descriptor", () => {
    expect(prepareMermaidSource("graph TD; A-->B;")).toContain("defaultRenderer");
  });

  it("wraps sequence messages instead of stretching lifelines", () => {
    const prepared = prepareMermaidSource("sequenceDiagram\n  A->>B: hi");
    expect(prepared).toContain('"wrap":true');
    expect(prepared).toContain("sequenceDiagram");
    expect(prepared).toContain(String(SEQUENCE_WRAP_CONFIG.actorMargin));
  });

  it("does not re-layout sequence diagrams", () => {
    const action = mermaidLoadAction("sequenceDiagram\n  A->>B: hi");
    expect(action.layout).toBeUndefined();
    const descriptor = action.descriptor as { data: string };
    expect(descriptor.data).toContain("sequenceDiagram");
    expect(descriptor.data).toContain('"wrap":true');
    expect(descriptor.data).toContain(`"width":${SEQUENCE_WRAP_CONFIG.width}`);
  });
});

import { describe, expect, it } from "vitest";
import { EMPTY_DRAWIO_XML } from "../../editor/drawio/constants";
import {
  addEdge,
  addNode,
  mutateDiagram,
  removeElement,
  summarizeDrawio,
  updateElement,
} from "./model";

describe("drawio semantic model", () => {
  it("summarizes an empty diagram", async () => {
    const summary = await summarizeDrawio(EMPTY_DRAWIO_XML);
    expect(summary.pages).toHaveLength(1);
    expect(summary.pages[0]!.nodes).toEqual([]);
    expect(summary.pages[0]!.edges).toEqual([]);
  });

  it("adds nodes and edges, then updates and removes", async () => {
    let xml = EMPTY_DRAWIO_XML;

    const a = await addNode(xml, { label: "Auth", shape: "rounded", x: 40, y: 40 });
    xml = a.xml;
    const b = await addNode(xml, {
      label: "API",
      shape: "rectangle",
      x: 240,
      y: 40,
    });
    xml = b.xml;
    const e = await addEdge(xml, {
      source: a.id,
      target: b.id,
      label: "calls",
    });
    xml = e.xml;

    let summary = await summarizeDrawio(xml);
    expect(summary.pages[0]!.nodes.map((n) => n.label)).toEqual(["Auth", "API"]);
    expect(summary.pages[0]!.edges).toHaveLength(1);
    expect(summary.pages[0]!.edges[0]!.label).toBe("calls");

    const updated = await updateElement(xml, {
      id: a.id,
      label: "Auth Service",
      y: 80,
    });
    xml = updated.xml;
    summary = await summarizeDrawio(xml);
    const auth = summary.pages[0]!.nodes.find((n) => n.id === a.id);
    expect(auth?.label).toBe("Auth Service");
    expect(auth?.y).toBe(80);

    const removed = await removeElement(xml, { id: a.id });
    xml = removed.xml;
    expect(removed.removed).toContain(a.id);
    expect(removed.removed).toContain(e.id);
    summary = await summarizeDrawio(xml);
    expect(summary.pages[0]!.nodes.map((n) => n.label)).toEqual(["API"]);
    expect(summary.pages[0]!.edges).toHaveLength(0);
  });

  it("rejects edges to missing nodes", async () => {
    await expect(
      addEdge(EMPTY_DRAWIO_XML, { source: "2", target: "3" }),
    ).rejects.toThrow(/source cell not found/i);
  });

  it("applies and updates fill/stroke/font colors", async () => {
    let xml = EMPTY_DRAWIO_XML;
    const a = await addNode(xml, {
      label: "Brand",
      shape: "rounded",
      x: 10,
      y: 10,
      fill_color: "#cb11ab",
      stroke_color: "#a00e89",
      font_color: "#fff",
    });
    xml = a.xml;

    let summary = await summarizeDrawio(xml);
    const node = summary.pages[0]!.nodes[0]!;
    expect(node.fill_color).toBe("#cb11ab");
    expect(node.stroke_color).toBe("#a00e89");
    expect(node.font_color).toBe("#ffffff");
    expect(node.style).toContain("fillColor=#cb11ab");

    const updated = await updateElement(xml, {
      id: a.id,
      fill_color: "#111111",
    });
    xml = updated.xml;
    summary = await summarizeDrawio(xml);
    const again = summary.pages[0]!.nodes[0]!;
    expect(again.fill_color).toBe("#111111");
    expect(again.stroke_color).toBe("#a00e89");
  });

  it("rejects invalid colors", async () => {
    await expect(
      addNode(EMPTY_DRAWIO_XML, {
        label: "Bad",
        fill_color: "magenta",
      }),
    ).rejects.toThrow(/fill_color must be/);
  });

  it("mutate_diagram applies nodes, colors, and edges atomically with temp_id", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        {
          label: "A",
          temp_id: "a",
          x: 0,
          y: 0,
          fill_color: "#cb11ab",
        },
        {
          label: "B",
          temp_id: "b",
          x: 200,
          y: 0,
          fill_color: "#cb11ab",
        },
      ],
      add_edges: [{ source: "a", target: "b", label: "link" }],
    });

    expect(result.added_nodes).toHaveLength(2);
    expect(result.added_edges).toHaveLength(1);

    const summary = await summarizeDrawio(result.xml);
    expect(summary.pages[0]!.nodes).toHaveLength(2);
    expect(summary.pages[0]!.nodes.every((n) => n.fill_color === "#cb11ab")).toBe(
      true,
    );
    expect(summary.pages[0]!.edges).toHaveLength(1);
    expect(summary.pages[0]!.edges[0]!.source).toBe(result.added_nodes[0]!.id);
    expect(summary.pages[0]!.edges[0]!.target).toBe(result.added_nodes[1]!.id);
  });
});

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
  it("summarizes an empty diagram with page settings", async () => {
    const summary = await summarizeDrawio(EMPTY_DRAWIO_XML);
    expect(summary.pages).toHaveLength(1);
    expect(summary.pages[0]!.nodes).toEqual([]);
    expect(summary.pages[0]!.edges).toEqual([]);
    expect(summary.pages[0]!.settings.grid).toBe(true);
    expect(summary.pages[0]!.settings.page).toBe(true);
    expect(summary.pages[0]!.settings.sketch).toBe(false);
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

  it("applies text alignment, font, and sketch on nodes", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        {
          label: "Title",
          temp_id: "t",
          align: "left",
          vertical_align: "top",
          font_size: 18,
          font_bold: true,
          sketch: true,
          x: 10,
          y: 10,
        },
      ],
    });
    const summary = await summarizeDrawio(result.xml);
    const node = summary.pages[0]!.nodes[0]!;
    expect(node.align).toBe("left");
    expect(node.vertical_align).toBe("top");
    expect(node.font_size).toBe(18);
    expect(node.sketch).toBe(true);
    expect(node.style).toContain("fontStyle=1");
  });

  it("updates page settings including sketch-all and grid", async () => {
    const seeded = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        { label: "A", temp_id: "a", x: 0, y: 0 },
        { label: "B", temp_id: "b", x: 100, y: 0 },
      ],
      add_edges: [{ source: "a", target: "b" }],
    });

    const result = await mutateDiagram(seeded.xml, {
      page_settings: {
        grid: false,
        grid_size: 20,
        page: false,
        shadow: true,
        sketch: true,
      },
    });

    const summary = await summarizeDrawio(result.xml);
    const settings = summary.pages[0]!.settings;
    expect(settings.grid).toBe(false);
    expect(settings.grid_size).toBe(20);
    expect(settings.page).toBe(false);
    expect(settings.shadow).toBe(true);
    expect(settings.sketch).toBe(true);
    expect(summary.pages[0]!.nodes.every((n) => n.sketch)).toBe(true);
    expect(
      summary.pages[0]!.edges.every((e) => e.style.includes("sketch=1")),
    ).toBe(true);
  });

  it("creates ArchiMate shapes and relations", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        {
          label: "CRM",
          temp_id: "crm",
          shape: "archimate.application_component",
          x: 40,
          y: 40,
        },
        {
          label: "Billing",
          temp_id: "bill",
          shape: "archimate.application_service",
          x: 280,
          y: 40,
        },
        {
          label: "Customer",
          temp_id: "actor",
          shape: "archimate.business_actor",
          x: 40,
          y: 200,
        },
      ],
      add_edges: [
        { source: "crm", target: "bill", relation: "serving" },
        { source: "actor", target: "crm", relation: "assignment" },
      ],
    });

    const summary = await summarizeDrawio(result.xml);
    expect(summary.pages[0]!.nodes).toHaveLength(3);
    const crm = summary.pages[0]!.nodes.find((n) => n.label === "CRM")!;
    expect(crm.style).toContain("mxgraph.archimate3");
    expect(crm.style).toContain("appType=comp");
    expect(crm.width).toBe(150);
    expect(crm.height).toBe(75);
    expect(crm.fill_color?.toLowerCase()).toBe("#99ffff");

    const serving = summary.pages[0]!.edges.find((e) => e.source === crm.id)!;
    expect(serving.style).toContain("endArrow=open");
    expect(serving.style).toContain("elbowEdgeStyle");
  });

  it("nests children in a group via parent temp_id and cascades remove", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        {
          label: "App Layer",
          temp_id: "g",
          shape: "group",
          x: 20,
          y: 20,
          width: 400,
          height: 240,
        },
        {
          label: "API",
          temp_id: "api",
          parent: "g",
          x: 40,
          y: 40,
        },
      ],
    });

    let summary = await summarizeDrawio(result.xml);
    const group = summary.pages[0]!.nodes.find((n) => n.label === "App Layer")!;
    const api = summary.pages[0]!.nodes.find((n) => n.label === "API")!;
    expect(group.container).toBe(true);
    expect(api.parent).toBe(group.id);

    const removed = await mutateDiagram(result.xml, { remove: [group.id] });
    summary = await summarizeDrawio(removed.xml);
    expect(summary.pages[0]!.nodes).toHaveLength(0);
    expect(removed.removed).toEqual(expect.arrayContaining([group.id, api.id]));
  });

  it("stores edge waypoints and ports", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        { label: "A", temp_id: "a", x: 0, y: 0 },
        { label: "B", temp_id: "b", x: 200, y: 100 },
      ],
      add_edges: [
        {
          source: "a",
          target: "b",
          exit_x: 1,
          exit_y: 0.5,
          entry_x: 0,
          entry_y: 0.5,
          waypoints: [
            { x: 120, y: 30 },
            { x: 120, y: 130 },
          ],
        },
      ],
    });

    const edge = (await summarizeDrawio(result.xml)).pages[0]!.edges[0]!;
    expect(edge.exit_x).toBe(1);
    expect(edge.exit_y).toBe(0.5);
    expect(edge.entry_x).toBe(0);
    expect(edge.entry_y).toBe(0.5);
    expect(edge.waypoints).toEqual([
      { x: 120, y: 30 },
      { x: 120, y: 130 },
    ]);
  });

  it("adds and renames pages", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_pages: [{ name: "ArchiMate" }],
      rename_pages: [{ from: "Page-1", to: "Overview" }],
    });

    expect(result.added_pages).toEqual([
      expect.objectContaining({ name: "ArchiMate" }),
    ]);
    expect(result.renamed_pages).toEqual([
      expect.objectContaining({ name: "Overview" }),
    ]);

    const summary = await summarizeDrawio(result.xml);
    expect(summary.pages.map((p) => p.name).sort()).toEqual([
      "ArchiMate",
      "Overview",
    ]);
  });

  it("applies hierarchical layout left-to-right when asked", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        { label: "A", temp_id: "a" },
        { label: "B", temp_id: "b" },
        { label: "C", temp_id: "c" },
      ],
      add_edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
      layout: {
        type: "hierarchical",
        direction: "left_right",
        origin_x: 10,
        origin_y: 10,
        gap_x: 50,
      },
    });

    const nodes = (await summarizeDrawio(result.xml)).pages[0]!.nodes;
    const a = nodes.find((n) => n.label === "A")!;
    const b = nodes.find((n) => n.label === "B")!;
    const c = nodes.find((n) => n.label === "C")!;
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
  });

  it("auto-layouts hierarchical flows top-down by default", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        { label: "A", temp_id: "a", x: 900, y: 10 },
        { label: "B", temp_id: "b", x: 10, y: 10 },
        { label: "C", temp_id: "c", x: 400, y: 10 },
      ],
      add_edges: [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    });

    expect(result.layout_applied).toBe(true);
    const nodes = (await summarizeDrawio(result.xml)).pages[0]!.nodes;
    const a = nodes.find((n) => n.label === "A")!;
    const b = nodes.find((n) => n.label === "B")!;
    const c = nodes.find((n) => n.label === "C")!;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it("auto-layouts ArchiMate by layer top-down, ignoring bad x/y", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        {
          label: "Node",
          temp_id: "n",
          shape: "archimate.node",
          x: 0,
          y: 0,
        },
        {
          label: "CRM",
          temp_id: "crm",
          shape: "archimate.application_component",
          x: 500,
          y: 0,
        },
        {
          label: "Actor",
          temp_id: "a",
          shape: "archimate.business_actor",
          x: 1000,
          y: 0,
        },
        {
          label: "Goal",
          temp_id: "g",
          shape: "archimate.goal",
          x: 1500,
          y: 0,
        },
      ],
    });

    expect(result.layout_applied).toBe(true);
    const nodes = (await summarizeDrawio(result.xml)).pages[0]!.nodes;
    const goal = nodes.find((n) => n.label === "Goal")!;
    const actor = nodes.find((n) => n.label === "Actor")!;
    const crm = nodes.find((n) => n.label === "CRM")!;
    const node = nodes.find((n) => n.label === "Node")!;
    // Motivation → Business → Application → Technology
    expect(goal.y).toBeLessThan(actor.y);
    expect(actor.y).toBeLessThan(crm.y);
    expect(crm.y).toBeLessThan(node.y);
  });

  it("layout none keeps explicit coordinates", async () => {
    const result = await mutateDiagram(EMPTY_DRAWIO_XML, {
      add_nodes: [
        { label: "A", temp_id: "a", x: 10, y: 20 },
        { label: "B", temp_id: "b", x: 300, y: 20 },
      ],
      layout: { type: "none" },
    });
    expect(result.layout_applied).toBe(false);
    const nodes = (await summarizeDrawio(result.xml)).pages[0]!.nodes;
    expect(nodes.find((n) => n.label === "A")!.x).toBe(10);
    expect(nodes.find((n) => n.label === "B")!.x).toBe(300);
  });
});

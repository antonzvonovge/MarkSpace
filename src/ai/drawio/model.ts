/**
 * Semantic layer over draw.io mxfile XML for agent tools.
 * Reads uncompressed or deflate-raw+base64 diagram payloads; writes uncompressed mxfile.
 */

import {
  DEFAULT_EDGE_STYLE,
  SHAPE_STYLES,
  RELATION_STYLES,
  defaultSizeForShape,
  isArchimateStyle,
  archimateLayerFromStyle,
  archimateLayerIndex,
  type DrawioRelation,
  type DrawioShape,
} from "./shapes";

export type { DrawioRelation, DrawioShape, ArchimateLayer } from "./shapes";
export {
  DRAWIO_RELATIONS,
  DRAWIO_SHAPES,
  DEFAULT_EDGE_STYLE,
  SHAPE_STYLES,
  RELATION_STYLES,
  ARCHIMATE_LAYER_ORDER,
} from "./shapes";

export type DrawioColors = {
  fill_color?: string;
  stroke_color?: string;
  font_color?: string;
};

export type DrawioTextStyle = {
  align?: "left" | "center" | "right";
  vertical_align?: "top" | "middle" | "bottom";
  font_size?: number;
  font_bold?: boolean;
  font_italic?: boolean;
  font_underline?: boolean;
  opacity?: number;
  dashed?: boolean;
  rounded?: boolean;
  sketch?: boolean;
};

export type DrawioPortStyle = {
  exit_x?: number;
  exit_y?: number;
  entry_x?: number;
  entry_y?: number;
};

export type DrawioStyleFields = DrawioColors & DrawioTextStyle & DrawioPortStyle;

export type DrawioWaypoint = { x: number; y: number };

export type DrawioNode = {
  id: string;
  kind: "vertex";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
  fill_color: string | null;
  stroke_color: string | null;
  font_color: string | null;
  align: string | null;
  vertical_align: string | null;
  font_size: number | null;
  sketch: boolean;
  parent: string;
  container: boolean;
};

export type DrawioEdge = {
  id: string;
  kind: "edge";
  label: string;
  source: string | null;
  target: string | null;
  style: string;
  fill_color: string | null;
  stroke_color: string | null;
  font_color: string | null;
  parent: string;
  waypoints: DrawioWaypoint[];
  exit_x: number | null;
  exit_y: number | null;
  entry_x: number | null;
  entry_y: number | null;
};

export type DrawioPageSettings = {
  grid: boolean;
  grid_size: number;
  guides: boolean;
  page: boolean;
  page_width: number;
  page_height: number;
  page_scale: number;
  shadow: boolean;
  math: boolean;
  sketch: boolean;
};

export type DrawioPageSummary = {
  id: string;
  name: string;
  settings: DrawioPageSettings;
  nodes: DrawioNode[];
  edges: DrawioEdge[];
};

export type DrawioDiagramSummary = {
  pages: DrawioPageSummary[];
};

export type PageSettingsInput = {
  grid?: boolean;
  grid_size?: number;
  guides?: boolean;
  /** Show page view / page breaks. */
  page?: boolean;
  page_width?: number;
  page_height?: number;
  page_scale?: number;
  shadow?: boolean;
  math?: boolean;
  /** Apply/remove sketch=1 on all vertices and edges on the page. */
  sketch?: boolean;
};

export type LayoutInput = {
  /**
   * auto — pick archimate / hierarchical / grid from content.
   * none — skip layout (keep coordinates).
   * archimate — rows by ArchiMate layer (motivation→…→technology), top-down.
   * hierarchical — flow by edges.
   * grid — fixed columns.
   */
  type: "auto" | "none" | "grid" | "hierarchical" | "archimate";
  /** Flow direction for hierarchical / archimate. Default: top_down. */
  direction?: "top_down" | "left_right";
  columns?: number;
  origin_x?: number;
  origin_y?: number;
  gap_x?: number;
  gap_y?: number;
  /** Only reposition these ids (default: all top-level vertices). */
  ids?: string[];
};

/** Normalize #RGB / #RRGGBB / named none; throw on junk. */
export function normalizeColor(raw: string, field: string): string {
  const v = raw.trim();
  if (!v) throw new Error(`${field} must be a non-empty color`);
  if (/^none$/i.test(v)) return "none";
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    const [, r, g, b] = v;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  throw new Error(`${field} must be #RGB, #RRGGBB, or none (got: ${raw})`);
}

function parseStyleMap(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      map.set(trimmed, "");
      continue;
    }
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return map;
}

function serializeStyleMap(map: Map<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of map) {
    parts.push(v === "" ? k : `${k}=${v}`);
  }
  const joined = parts.join(";");
  return joined.endsWith(";") || joined === "" ? joined : `${joined};`;
}

function clamp01(n: number, field: string): number {
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
  return n;
}

function readFontFlags(fontStyle: string | undefined): {
  font_bold: boolean;
  font_italic: boolean;
  font_underline: boolean;
} {
  const n = Number(fontStyle ?? 0);
  return {
    font_bold: (n & 1) !== 0,
    font_italic: (n & 2) !== 0,
    font_underline: (n & 4) !== 0,
  };
}

function writeFontFlags(
  map: Map<string, string>,
  props: DrawioTextStyle,
): void {
  if (
    props.font_bold == null &&
    props.font_italic == null &&
    props.font_underline == null
  ) {
    return;
  }
  const cur = readFontFlags(map.get("fontStyle"));
  const bold = props.font_bold ?? cur.font_bold;
  const italic = props.font_italic ?? cur.font_italic;
  const underline = props.font_underline ?? cur.font_underline;
  const flags = (bold ? 1 : 0) | (italic ? 2 : 0) | (underline ? 4 : 0);
  if (flags === 0) map.delete("fontStyle");
  else map.set("fontStyle", String(flags));
}

export function applyStyleFields(
  baseStyle: string,
  props: DrawioStyleFields,
): string {
  const map = parseStyleMap(baseStyle);
  if (props.fill_color != null) {
    map.set("fillColor", normalizeColor(props.fill_color, "fill_color"));
  }
  if (props.stroke_color != null) {
    map.set("strokeColor", normalizeColor(props.stroke_color, "stroke_color"));
  }
  if (props.font_color != null) {
    map.set("fontColor", normalizeColor(props.font_color, "font_color"));
  }
  if (props.align != null) map.set("align", props.align);
  if (props.vertical_align != null) {
    map.set("verticalAlign", props.vertical_align);
  }
  if (props.font_size != null) {
    if (!(props.font_size > 0)) {
      throw new Error("font_size must be a positive number");
    }
    map.set("fontSize", String(props.font_size));
  }
  writeFontFlags(map, props);
  if (props.opacity != null) {
    if (!Number.isFinite(props.opacity) || props.opacity < 0 || props.opacity > 100) {
      throw new Error("opacity must be between 0 and 100");
    }
    map.set("opacity", String(props.opacity));
  }
  if (props.dashed != null) {
    if (props.dashed) map.set("dashed", "1");
    else map.delete("dashed");
  }
  if (props.rounded != null) {
    map.set("rounded", props.rounded ? "1" : "0");
  }
  if (props.sketch != null) {
    if (props.sketch) map.set("sketch", "1");
    else map.delete("sketch");
  }
  if (props.exit_x != null) {
    map.set("exitX", String(clamp01(props.exit_x, "exit_x")));
  }
  if (props.exit_y != null) {
    map.set("exitY", String(clamp01(props.exit_y, "exit_y")));
  }
  if (props.entry_x != null) {
    map.set("entryX", String(clamp01(props.entry_x, "entry_x")));
  }
  if (props.entry_y != null) {
    map.set("entryY", String(clamp01(props.entry_y, "entry_y")));
  }
  return serializeStyleMap(map);
}

/** @deprecated use applyStyleFields */
export function applyColors(
  baseStyle: string,
  colors: DrawioColors,
): string {
  return applyStyleFields(baseStyle, colors);
}

function colorsFromStyle(style: string): {
  fill_color: string | null;
  stroke_color: string | null;
  font_color: string | null;
} {
  const map = parseStyleMap(style);
  return {
    fill_color: map.get("fillColor") ?? null,
    stroke_color: map.get("strokeColor") ?? null,
    font_color: map.get("fontColor") ?? null,
  };
}

function textPropsFromStyle(style: string): {
  align: string | null;
  vertical_align: string | null;
  font_size: number | null;
  sketch: boolean;
} {
  const map = parseStyleMap(style);
  const fs = map.get("fontSize");
  return {
    align: map.get("align") ?? null,
    vertical_align: map.get("verticalAlign") ?? null,
    font_size: fs != null && fs !== "" ? Number(fs) : null,
    sketch: map.get("sketch") === "1",
  };
}

function portsFromStyle(style: string): {
  exit_x: number | null;
  exit_y: number | null;
  entry_x: number | null;
  entry_y: number | null;
} {
  const map = parseStyleMap(style);
  const num = (k: string) => {
    const v = map.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    exit_x: num("exitX"),
    exit_y: num("exitY"),
    entry_x: num("entryX"),
    entry_y: num("entryY"),
  };
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) {
    throw new Error(`Invalid XML: ${err.textContent?.slice(0, 200) ?? "parse error"}`);
  }
  return doc;
}

function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateRawToString(data: Uint8Array): Promise<string> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  ])
    .stream()
    .pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

/** draw.io often URL-encodes XML before deflateRaw+base64. */
async function decodeDiagramPayload(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<")) return trimmed;

  try {
    const inflated = await inflateRawToString(b64ToBytes(trimmed));
    try {
      return decodeURIComponent(inflated);
    } catch {
      return inflated;
    }
  } catch {
    if (trimmed.includes("<mxGraphModel") || trimmed.includes("<mxCell")) {
      return trimmed;
    }
    throw new Error(
      "Diagram page is compressed/encoded in an unsupported form. Re-save the .drawio from the editor and retry.",
    );
  }
}

async function ensureDiagramModel(diagram: Element): Promise<Element> {
  const existing = [...diagram.children].find((c) => c.localName === "mxGraphModel");
  if (existing) return existing;

  const text = diagram.textContent?.trim() ?? "";
  if (!text) {
    throw new Error(`Diagram page "${diagram.getAttribute("name") ?? "?"}" has no model`);
  }
  const xml = await decodeDiagramPayload(text);
  const inner = parseXml(xml);
  const model =
    inner.documentElement.localName === "mxGraphModel"
      ? inner.documentElement
      : inner.querySelector("mxGraphModel");
  if (!model) {
    throw new Error("Decoded diagram payload has no mxGraphModel");
  }
  while (diagram.firstChild) diagram.removeChild(diagram.firstChild);
  diagram.appendChild(diagram.ownerDocument.importNode(model, true));
  const attached = diagram.querySelector("mxGraphModel");
  if (!attached) throw new Error("Failed to attach mxGraphModel");
  return attached;
}

function cellValue(cell: Element): string {
  const v = cell.getAttribute("value") ?? "";
  return v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readGeometry(cell: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const geo = [...cell.children].find((c) => c.localName === "mxGeometry");
  return {
    x: Number(geo?.getAttribute("x") ?? 0),
    y: Number(geo?.getAttribute("y") ?? 0),
    width: Number(geo?.getAttribute("width") ?? 120),
    height: Number(geo?.getAttribute("height") ?? 60),
  };
}

function readWaypoints(cell: Element): DrawioWaypoint[] {
  const geo = [...cell.children].find((c) => c.localName === "mxGeometry");
  if (!geo) return [];
  const arr = [...geo.children].find(
    (c) => c.localName === "Array" && c.getAttribute("as") === "points",
  );
  if (!arr) return [];
  return [...arr.children]
    .filter((c) => c.localName === "mxPoint")
    .map((p) => ({
      x: Number(p.getAttribute("x") ?? 0),
      y: Number(p.getAttribute("y") ?? 0),
    }));
}

function setWaypoints(
  doc: Document,
  cell: Element,
  points: DrawioWaypoint[] | null | undefined,
): void {
  if (points == null) return;
  let geo = [...cell.children].find((c) => c.localName === "mxGeometry");
  if (!geo) {
    geo = doc.createElement("mxGeometry");
    geo.setAttribute("relative", "1");
    geo.setAttribute("as", "geometry");
    cell.appendChild(geo);
  }
  for (const child of [...geo.children]) {
    if (child.localName === "Array" && child.getAttribute("as") === "points") {
      geo.removeChild(child);
    }
  }
  if (points.length === 0) return;
  const arr = doc.createElement("Array");
  arr.setAttribute("as", "points");
  for (const p of points) {
    const pt = doc.createElement("mxPoint");
    pt.setAttribute("x", String(p.x));
    pt.setAttribute("y", String(p.y));
    arr.appendChild(pt);
  }
  geo.appendChild(arr);
}

function boolAttr(model: Element, name: string, fallback: boolean): boolean {
  const v = model.getAttribute(name);
  if (v == null) return fallback;
  return v === "1" || v === "true";
}

function numAttr(model: Element, name: string, fallback: number): number {
  const v = model.getAttribute(name);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function readPageSettings(model: Element, root: Element): DrawioPageSettings {
  let sketch = false;
  for (const cell of root.children) {
    if (cell.localName !== "mxCell") continue;
    const id = cell.getAttribute("id");
    if (!id || id === "0" || id === "1") continue;
    const style = cell.getAttribute("style") ?? "";
    if (parseStyleMap(style).get("sketch") === "1") {
      sketch = true;
      break;
    }
  }
  return {
    grid: boolAttr(model, "grid", true),
    grid_size: numAttr(model, "gridSize", 10),
    guides: boolAttr(model, "guides", true),
    page: boolAttr(model, "page", true),
    page_width: numAttr(model, "pageWidth", 850),
    page_height: numAttr(model, "pageHeight", 1100),
    page_scale: numAttr(model, "pageScale", 1),
    shadow: boolAttr(model, "shadow", false),
    math: boolAttr(model, "math", false),
    sketch,
  };
}

function applyPageSettings(model: Element, root: Element, input: PageSettingsInput) {
  const setBool = (attr: string, v: boolean | undefined) => {
    if (v == null) return;
    model.setAttribute(attr, v ? "1" : "0");
  };
  const setNum = (attr: string, v: number | undefined, field: string) => {
    if (v == null) return;
    if (!Number.isFinite(v) || v <= 0) {
      throw new Error(`${field} must be a positive number`);
    }
    model.setAttribute(attr, String(v));
  };
  setBool("grid", input.grid);
  setNum("gridSize", input.grid_size, "grid_size");
  setBool("guides", input.guides);
  setBool("page", input.page);
  setNum("pageWidth", input.page_width, "page_width");
  setNum("pageHeight", input.page_height, "page_height");
  if (input.page_scale != null) {
    if (!Number.isFinite(input.page_scale) || input.page_scale <= 0) {
      throw new Error("page_scale must be a positive number");
    }
    model.setAttribute("pageScale", String(input.page_scale));
  }
  setBool("shadow", input.shadow);
  setBool("math", input.math);

  if (input.sketch != null) {
    for (const cell of root.children) {
      if (cell.localName !== "mxCell") continue;
      const id = cell.getAttribute("id");
      if (!id || id === "0" || id === "1") continue;
      const isEdge = cell.getAttribute("edge") === "1";
      const isVertex = cell.getAttribute("vertex") === "1";
      if (!isEdge && !isVertex) continue;
      const style = applyStyleFields(cell.getAttribute("style") ?? "", {
        sketch: input.sketch,
      });
      cell.setAttribute("style", style);
    }
  }
}

function isContainerStyle(style: string): boolean {
  const map = parseStyleMap(style);
  return (
    map.has("group") ||
    map.has("swimlane") ||
    map.get("container") === "1" ||
    (map.get("shape") ?? "").includes("grouping")
  );
}

function summarizePage(diagram: Element, model: Element): DrawioPageSummary {
  const root = [...model.children].find((c) => c.localName === "root");
  const cells = root
    ? [...root.children].filter((c) => c.localName === "mxCell")
    : [];

  const nodes: DrawioNode[] = [];
  const edges: DrawioEdge[] = [];

  for (const cell of cells) {
    const id = cell.getAttribute("id") ?? "";
    if (!id || id === "0" || id === "1") continue;
    const parent = cell.getAttribute("parent") ?? "1";
    const style = cell.getAttribute("style") ?? "";
    const label = cellValue(cell);
    const colors = colorsFromStyle(style);
    const text = textPropsFromStyle(style);

    if (cell.getAttribute("edge") === "1") {
      const ports = portsFromStyle(style);
      edges.push({
        id,
        kind: "edge",
        label,
        source: cell.getAttribute("source"),
        target: cell.getAttribute("target"),
        style,
        ...colors,
        parent,
        waypoints: readWaypoints(cell),
        ...ports,
      });
      continue;
    }

    if (cell.getAttribute("vertex") === "1") {
      const g = readGeometry(cell);
      nodes.push({
        id,
        kind: "vertex",
        label,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        style,
        ...colors,
        ...text,
        parent,
        container: isContainerStyle(style),
      });
    }
  }

  return {
    id: diagram.getAttribute("id") ?? "",
    name: diagram.getAttribute("name") ?? "Page-1",
    settings: readPageSettings(model, root ?? model),
    nodes,
    edges,
  };
}

export async function summarizeDrawio(xml: string): Promise<DrawioDiagramSummary> {
  const doc = parseXml(xml);
  const mxfile =
    doc.documentElement.localName === "mxfile"
      ? doc.documentElement
      : doc.querySelector("mxfile");
  if (!mxfile) throw new Error("Not a draw.io mxfile");

  const diagrams = [...mxfile.children].filter((c) => c.localName === "diagram");
  if (diagrams.length === 0) throw new Error("mxfile has no diagram pages");

  const pages: DrawioPageSummary[] = [];
  for (const diagram of diagrams) {
    const model = await ensureDiagramModel(diagram);
    pages.push(summarizePage(diagram, model));
  }
  return { pages };
}

type MutableDoc = {
  doc: Document;
  mxfile: Element;
  diagram: Element;
  model: Element;
  root: Element;
};

async function openMutable(xml: string, page?: string): Promise<MutableDoc> {
  const doc = parseXml(xml);
  const mxfile =
    doc.documentElement.localName === "mxfile"
      ? doc.documentElement
      : doc.querySelector("mxfile");
  if (!mxfile) throw new Error("Not a draw.io mxfile");

  const diagrams = [...mxfile.children].filter((c) => c.localName === "diagram");
  if (diagrams.length === 0) throw new Error("mxfile has no diagram pages");

  let diagram = diagrams[0]!;
  if (page) {
    const found = diagrams.find(
      (d) =>
        d.getAttribute("name") === page || d.getAttribute("id") === page,
    );
    if (!found) {
      throw new Error(
        `Page not found: ${page}. Available: ${diagrams
          .map((d) => d.getAttribute("name") ?? d.getAttribute("id"))
          .join(", ")}`,
      );
    }
    diagram = found;
  }

  const model = await ensureDiagramModel(diagram);
  let root = [...model.children].find((c) => c.localName === "root");
  if (!root) {
    root = doc.createElement("root");
    const c0 = doc.createElement("mxCell");
    c0.setAttribute("id", "0");
    const c1 = doc.createElement("mxCell");
    c1.setAttribute("id", "1");
    c1.setAttribute("parent", "0");
    root.appendChild(c0);
    root.appendChild(c1);
    model.appendChild(root);
  }

  return { doc, mxfile, diagram, model, root };
}

function nextCellId(root: Element): string {
  let max = 1;
  for (const cell of root.children) {
    if (cell.localName !== "mxCell") continue;
    const id = cell.getAttribute("id") ?? "";
    const n = Number(id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

function findCell(root: Element, id: string): Element | null {
  for (const cell of root.children) {
    if (cell.localName === "mxCell" && cell.getAttribute("id") === id) {
      return cell;
    }
  }
  return null;
}

function defaultPosition(root: Element): { x: number; y: number } {
  const vertices = [...root.children].filter(
    (c) => c.localName === "mxCell" && c.getAttribute("vertex") === "1",
  );
  const col = vertices.length % 3;
  const row = Math.floor(vertices.length / 3);
  return { x: 40 + col * 200, y: 40 + row * 120 };
}

function nextPageId(mxfile: Element): string {
  let max = 0;
  for (const d of mxfile.children) {
    if (d.localName !== "diagram") continue;
    const id = d.getAttribute("id") ?? "";
    const m = /^page-(\d+)$/i.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `page-${max + 1}`;
}

function emptyPageModel(doc: Document): Element {
  const model = doc.createElement("mxGraphModel");
  model.setAttribute("dx", "800");
  model.setAttribute("dy", "600");
  model.setAttribute("grid", "1");
  model.setAttribute("gridSize", "10");
  model.setAttribute("guides", "1");
  model.setAttribute("tooltips", "1");
  model.setAttribute("connect", "1");
  model.setAttribute("arrows", "1");
  model.setAttribute("fold", "1");
  model.setAttribute("page", "1");
  model.setAttribute("pageScale", "1");
  model.setAttribute("pageWidth", "850");
  model.setAttribute("pageHeight", "1100");
  model.setAttribute("math", "0");
  model.setAttribute("shadow", "0");
  const root = doc.createElement("root");
  const c0 = doc.createElement("mxCell");
  c0.setAttribute("id", "0");
  const c1 = doc.createElement("mxCell");
  c1.setAttribute("id", "1");
  c1.setAttribute("parent", "0");
  root.appendChild(c0);
  root.appendChild(c1);
  model.appendChild(root);
  return model;
}

function applyAddPage(
  ctx: MutableDoc,
  input: { name: string; id?: string },
): { id: string; name: string } {
  const name = input.name.trim();
  if (!name) throw new Error("page name must be non-empty");
  const diagrams = [...ctx.mxfile.children].filter((c) => c.localName === "diagram");
  if (diagrams.some((d) => d.getAttribute("name") === name)) {
    throw new Error(`Page name already exists: ${name}`);
  }
  const id = input.id?.trim() || nextPageId(ctx.mxfile);
  if (diagrams.some((d) => d.getAttribute("id") === id)) {
    throw new Error(`Page id already exists: ${id}`);
  }
  const diagram = ctx.doc.createElement("diagram");
  diagram.setAttribute("id", id);
  diagram.setAttribute("name", name);
  diagram.appendChild(emptyPageModel(ctx.doc));
  ctx.mxfile.appendChild(diagram);
  return { id, name };
}

function applyRenamePage(
  ctx: MutableDoc,
  input: { from: string; to: string },
): { id: string; name: string } {
  const diagrams = [...ctx.mxfile.children].filter((c) => c.localName === "diagram");
  const found = diagrams.find(
    (d) =>
      d.getAttribute("name") === input.from || d.getAttribute("id") === input.from,
  );
  if (!found) throw new Error(`Page not found: ${input.from}`);
  const to = input.to.trim();
  if (!to) throw new Error("new page name must be non-empty");
  if (
    diagrams.some(
      (d) => d !== found && (d.getAttribute("name") === to || d.getAttribute("id") === to),
    )
  ) {
    throw new Error(`Page name already exists: ${to}`);
  }
  found.setAttribute("name", to);
  return {
    id: found.getAttribute("id") ?? "",
    name: to,
  };
}

export type AddNodeInput = DrawioStyleFields & {
  label: string;
  shape?: DrawioShape;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: string;
  parent?: string;
  page?: string;
  id?: string;
  /** Alias resolved within the same mutate_diagram call (and for edges). */
  temp_id?: string;
  /** Container group/swimlane — children use parent=this id. */
  container?: boolean;
  locked?: boolean;
  z_order?: "front" | "back";
};

function styleFieldsFrom(input: DrawioStyleFields): DrawioStyleFields {
  return {
    fill_color: input.fill_color,
    stroke_color: input.stroke_color,
    font_color: input.font_color,
    align: input.align,
    vertical_align: input.vertical_align,
    font_size: input.font_size,
    font_bold: input.font_bold,
    font_italic: input.font_italic,
    font_underline: input.font_underline,
    opacity: input.opacity,
    dashed: input.dashed,
    rounded: input.rounded,
    sketch: input.sketch,
    exit_x: input.exit_x,
    exit_y: input.exit_y,
    entry_x: input.entry_x,
    entry_y: input.entry_y,
  };
}

function applyAddNode(ctx: MutableDoc, input: AddNodeInput): string {
  const { doc, root } = ctx;
  const id = input.id ?? nextCellId(root);
  if (findCell(root, id)) throw new Error(`Cell id already exists: ${id}`);

  const shape = input.shape ?? "rounded";
  const defaults = defaultSizeForShape(shape);
  const pos =
    input.x != null && input.y != null
      ? { x: input.x, y: input.y }
      : defaultPosition(root);
  const width = input.width ?? defaults.width;
  const height = input.height ?? defaults.height;
  let base = input.style ?? SHAPE_STYLES[shape];
  if (input.container && !isContainerStyle(base)) {
    base = applyStyleFields(base, {}) + "container=1;";
    const map = parseStyleMap(base);
    map.set("container", "1");
    base = serializeStyleMap(map);
  }
  let style = applyStyleFields(base, styleFieldsFrom(input));
  if (input.locked) {
    const map = parseStyleMap(style);
    map.set("locked", "1");
    style = serializeStyleMap(map);
  }

  const cell = doc.createElement("mxCell");
  const parent = input.parent ?? "1";
  if (parent !== "1" && !findCell(root, parent)) {
    throw new Error(`parent cell not found: ${parent}`);
  }

  cell.setAttribute("id", id);
  cell.setAttribute("value", input.label);
  cell.setAttribute("style", style);
  cell.setAttribute("vertex", "1");
  cell.setAttribute("parent", parent);

  const geo = doc.createElement("mxGeometry");
  geo.setAttribute("x", String(pos.x));
  geo.setAttribute("y", String(pos.y));
  geo.setAttribute("width", String(width));
  geo.setAttribute("height", String(height));
  geo.setAttribute("as", "geometry");
  cell.appendChild(geo);

  if (input.z_order === "back") {
    const anchor = [...root.children].find(
      (c) => c.localName === "mxCell" && c.getAttribute("id") === "1",
    );
    if (anchor?.nextSibling) root.insertBefore(cell, anchor.nextSibling);
    else root.appendChild(cell);
  } else {
    root.appendChild(cell);
  }
  return id;
}

export async function addNode(
  xml: string,
  input: AddNodeInput,
): Promise<{ xml: string; id: string }> {
  const ctx = await openMutable(xml, input.page);
  const id = applyAddNode(ctx, input);
  return { xml: serializeXml(ctx.doc), id };
}

export type AddEdgeInput = DrawioStyleFields & {
  source: string;
  target: string;
  label?: string;
  style?: string;
  relation?: DrawioRelation;
  waypoints?: DrawioWaypoint[];
  page?: string;
  id?: string;
};

function resolveRef(
  ref: string,
  aliases: Map<string, string>,
  root: Element,
  kind: "source" | "target" | "parent" | "id",
): string {
  const mapped = aliases.get(ref) ?? ref;
  if (!findCell(root, mapped)) {
    throw new Error(
      `${kind} cell not found: ${ref}${mapped !== ref ? ` (resolved ${mapped})` : ""}`,
    );
  }
  return mapped;
}

function applyAddEdge(
  ctx: MutableDoc,
  input: AddEdgeInput,
  aliases: Map<string, string>,
): string {
  const { doc, root } = ctx;
  const source = resolveRef(input.source, aliases, root, "source");
  const target = resolveRef(input.target, aliases, root, "target");
  const id = input.id ?? nextCellId(root);
  if (findCell(root, id)) throw new Error(`Cell id already exists: ${id}`);

  const relation = input.relation ?? "default";
  const base = input.style ?? RELATION_STYLES[relation] ?? DEFAULT_EDGE_STYLE;
  const style = applyStyleFields(base, styleFieldsFrom(input));

  const cell = doc.createElement("mxCell");
  cell.setAttribute("id", id);
  cell.setAttribute("value", input.label ?? "");
  cell.setAttribute("style", style);
  cell.setAttribute("edge", "1");
  cell.setAttribute("parent", "1");
  cell.setAttribute("source", source);
  cell.setAttribute("target", target);

  const geo = doc.createElement("mxGeometry");
  geo.setAttribute("relative", "1");
  geo.setAttribute("as", "geometry");
  cell.appendChild(geo);
  setWaypoints(doc, cell, input.waypoints);
  root.appendChild(cell);
  return id;
}

export async function addEdge(
  xml: string,
  input: AddEdgeInput,
): Promise<{ xml: string; id: string }> {
  const ctx = await openMutable(xml, input.page);
  const id = applyAddEdge(ctx, input, new Map());
  return { xml: serializeXml(ctx.doc), id };
}

export type UpdateElementInput = DrawioStyleFields & {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: string;
  source?: string;
  target?: string;
  parent?: string;
  relation?: DrawioRelation;
  waypoints?: DrawioWaypoint[];
  locked?: boolean;
  z_order?: "front" | "back";
  page?: string;
};

function applyUpdateElement(
  ctx: MutableDoc,
  input: UpdateElementInput,
  aliases: Map<string, string>,
): string {
  const { doc, root } = ctx;
  const cell = findCell(root, aliases.get(input.id) ?? input.id);
  if (!cell) throw new Error(`Cell not found: ${input.id}`);

  if (input.label != null) cell.setAttribute("value", input.label);

  const styleTouch =
    input.style != null ||
    input.relation != null ||
    input.fill_color != null ||
    input.stroke_color != null ||
    input.font_color != null ||
    input.align != null ||
    input.vertical_align != null ||
    input.font_size != null ||
    input.font_bold != null ||
    input.font_italic != null ||
    input.font_underline != null ||
    input.opacity != null ||
    input.dashed != null ||
    input.rounded != null ||
    input.sketch != null ||
    input.exit_x != null ||
    input.exit_y != null ||
    input.entry_x != null ||
    input.entry_y != null ||
    input.locked != null;

  if (styleTouch) {
    let base = input.style ?? cell.getAttribute("style") ?? "";
    if (input.relation != null) {
      // Replace edge routing/arrows with relation preset, keep colors via apply after.
      base = RELATION_STYLES[input.relation] ?? base;
    }
    let style = applyStyleFields(base, styleFieldsFrom(input));
    if (input.locked != null) {
      const map = parseStyleMap(style);
      if (input.locked) map.set("locked", "1");
      else map.delete("locked");
      style = serializeStyleMap(map);
    }
    cell.setAttribute("style", style);
  }

  if (input.source != null) {
    cell.setAttribute(
      "source",
      resolveRef(input.source, aliases, root, "source"),
    );
  }
  if (input.target != null) {
    cell.setAttribute(
      "target",
      resolveRef(input.target, aliases, root, "target"),
    );
  }
  if (input.parent != null) {
    const parent =
      input.parent === "1"
        ? "1"
        : resolveRef(input.parent, aliases, root, "parent");
    cell.setAttribute("parent", parent);
  }

  if (
    input.x != null ||
    input.y != null ||
    input.width != null ||
    input.height != null
  ) {
    let geo = [...cell.children].find((c) => c.localName === "mxGeometry");
    if (!geo) {
      geo = doc.createElement("mxGeometry");
      geo.setAttribute("as", "geometry");
      cell.appendChild(geo);
    }
    if (input.x != null) geo.setAttribute("x", String(input.x));
    if (input.y != null) geo.setAttribute("y", String(input.y));
    if (input.width != null) geo.setAttribute("width", String(input.width));
    if (input.height != null) geo.setAttribute("height", String(input.height));
  }

  if (input.waypoints != null) {
    setWaypoints(doc, cell, input.waypoints);
  }

  if (input.z_order === "front") {
    root.appendChild(cell);
  } else if (input.z_order === "back") {
    const anchor = [...root.children].find(
      (c) => c.localName === "mxCell" && c.getAttribute("id") === "1",
    );
    if (anchor?.nextSibling) root.insertBefore(cell, anchor.nextSibling);
    else root.insertBefore(cell, root.firstChild);
  }

  return cell.getAttribute("id") ?? input.id;
}

export async function updateElement(
  xml: string,
  input: UpdateElementInput,
): Promise<{ xml: string; id: string }> {
  const ctx = await openMutable(xml, input.page);
  const id = applyUpdateElement(ctx, input, new Map());
  return { xml: serializeXml(ctx.doc), id };
}

function collectDescendants(root: Element, id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const other of root.children) {
      if (other.localName !== "mxCell") continue;
      if (other.getAttribute("parent") !== cur) continue;
      const oid = other.getAttribute("id");
      if (!oid || oid === "0" || oid === "1") continue;
      out.push(oid);
      queue.push(oid);
    }
  }
  return out;
}

function applyRemoveElement(ctx: MutableDoc, id: string): string[] {
  const { root } = ctx;
  const cell = findCell(root, id);
  if (!cell) throw new Error(`Cell not found: ${id}`);

  const removed = new Set<string>([id]);
  for (const childId of collectDescendants(root, id)) {
    removed.add(childId);
  }

  // Cascade edges touching any removed vertex.
  for (const other of [...root.children]) {
    if (other.localName !== "mxCell") continue;
    if (other.getAttribute("edge") !== "1") continue;
    const src = other.getAttribute("source");
    const tgt = other.getAttribute("target");
    if ((src && removed.has(src)) || (tgt && removed.has(tgt))) {
      const eid = other.getAttribute("id");
      if (eid) removed.add(eid);
    }
  }

  for (const rid of removed) {
    const el = findCell(root, rid);
    if (el) root.removeChild(el);
  }
  return [...removed];
}

export async function removeElement(
  xml: string,
  opts: { id: string; page?: string },
): Promise<{ xml: string; removed: string[]; id: string }> {
  const ctx = await openMutable(xml, opts.page);
  const removed = applyRemoveElement(ctx, opts.id);
  return { xml: serializeXml(ctx.doc), removed, id: opts.id };
}

function setCellPosition(cell: Element, x: number, y: number) {
  const geo = [...cell.children].find((c) => c.localName === "mxGeometry");
  if (!geo) return;
  geo.setAttribute("x", String(Math.round(x)));
  geo.setAttribute("y", String(Math.round(y)));
}

function collectLayoutVertices(root: Element, layout: LayoutInput): Element[] {
  return [...root.children].filter((c) => {
    if (c.localName !== "mxCell" || c.getAttribute("vertex") !== "1") return false;
    const id = c.getAttribute("id") ?? "";
    if (!id || id === "0" || id === "1") return false;
    if (layout.ids && !layout.ids.includes(id)) return false;
    if (!layout.ids && (c.getAttribute("parent") ?? "1") !== "1") return false;
    return true;
  });
}

function countEdgesAmong(root: Element, idSet: Set<string>): number {
  let n = 0;
  for (const cell of root.children) {
    if (cell.localName !== "mxCell" || cell.getAttribute("edge") !== "1") continue;
    const s = cell.getAttribute("source");
    const t = cell.getAttribute("target");
    if (s && t && idSet.has(s) && idSet.has(t)) n += 1;
  }
  return n;
}

function resolveLayoutType(
  root: Element,
  vertices: Element[],
  requested: LayoutInput["type"],
): "grid" | "hierarchical" | "archimate" {
  if (requested === "grid" || requested === "hierarchical" || requested === "archimate") {
    return requested;
  }
  const archi = vertices.filter((c) =>
    isArchimateStyle(c.getAttribute("style") ?? ""),
  ).length;
  if (archi >= 2 || (archi >= 1 && archi >= Math.ceil(vertices.length / 2))) {
    return "archimate";
  }
  const ids = new Set(vertices.map((v) => v.getAttribute("id")!));
  if (countEdgesAmong(root, ids) > 0) return "hierarchical";
  return "grid";
}

/** Place cells in bands indexed by layerRank along direction. */
function placeByRanks(
  cellsByRank: Map<number, Element[]>,
  opts: {
    direction: "top_down" | "left_right";
    originX: number;
    originY: number;
    gapX: number;
    gapY: number;
  },
) {
  const ranks = [...cellsByRank.keys()].sort((a, b) => a - b);
  let cursor = opts.direction === "top_down" ? opts.originY : opts.originX;

  for (const rank of ranks) {
    const cells = cellsByRank.get(rank) ?? [];
    if (cells.length === 0) continue;

    if (opts.direction === "top_down") {
      const bandH = Math.max(...cells.map((c) => readGeometry(c).height), 60);
      const maxW = Math.max(...cells.map((c) => readGeometry(c).width), 120);
      cells.forEach((cell, i) => {
        setCellPosition(cell, opts.originX + i * (maxW + opts.gapX), cursor);
      });
      cursor += bandH + opts.gapY;
    } else {
      const bandW = Math.max(...cells.map((c) => readGeometry(c).width), 120);
      const maxH = Math.max(...cells.map((c) => readGeometry(c).height), 60);
      cells.forEach((cell, i) => {
        setCellPosition(cell, cursor, opts.originY + i * (maxH + opts.gapY));
      });
      cursor += bandW + opts.gapX;
    }
  }
}

function hierarchicalRanks(
  root: Element,
  vertices: Element[],
): Map<number, Element[]> {
  const ids = vertices.map((v) => v.getAttribute("id")!);
  const idSet = new Set(ids);
  const outgoing = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    outgoing.set(id, []);
    indeg.set(id, 0);
  }
  for (const cell of root.children) {
    if (cell.localName !== "mxCell" || cell.getAttribute("edge") !== "1") continue;
    const s = cell.getAttribute("source");
    const t = cell.getAttribute("target");
    if (!s || !t || !idSet.has(s) || !idSet.has(t) || s === t) continue;
    outgoing.get(s)!.push(t);
    indeg.set(t, (indeg.get(t) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  for (const id of queue) layer.set(id, 0);
  const seen = new Set(queue);
  while (queue.length) {
    const cur = queue.shift()!;
    const L = layer.get(cur) ?? 0;
    for (const next of outgoing.get(cur) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, L + 1));
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  for (const id of ids) {
    if (!layer.has(id)) layer.set(id, 0);
  }

  const byLayer = new Map<number, Element[]>();
  for (const cell of vertices) {
    const id = cell.getAttribute("id")!;
    const L = layer.get(id) ?? 0;
    const list = byLayer.get(L) ?? [];
    list.push(cell);
    byLayer.set(L, list);
  }
  return byLayer;
}

function archimateRanks(vertices: Element[]): Map<number, Element[]> {
  const byLayer = new Map<number, Element[]>();
  for (const cell of vertices) {
    const style = cell.getAttribute("style") ?? "";
    const layerName = archimateLayerFromStyle(style) ?? "other";
    const rank = archimateLayerIndex(layerName);
    const list = byLayer.get(rank) ?? [];
    list.push(cell);
    byLayer.set(rank, list);
  }
  // Compact empty ranks so we don't leave huge vertical gaps
  const present = [...byLayer.keys()].sort((a, b) => a - b);
  const compact = new Map<number, Element[]>();
  present.forEach((old, i) => {
    compact.set(i, byLayer.get(old)!);
  });
  return compact;
}

function layoutGrid(
  vertices: Element[],
  opts: {
    columns: number;
    originX: number;
    originY: number;
    gapX: number;
    gapY: number;
  },
) {
  const columns = Math.max(1, opts.columns);
  vertices.forEach((cell, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const g = readGeometry(cell);
    setCellPosition(
      cell,
      opts.originX + col * (g.width + opts.gapX),
      opts.originY + row * (g.height + opts.gapY),
    );
  });
}

/** Pack children of each container into a small grid inside the parent. */
function layoutNestedChildren(root: Element, gapX: number, gapY: number) {
  const containers = [...root.children].filter((c) => {
    if (c.localName !== "mxCell" || c.getAttribute("vertex") !== "1") return false;
    return isContainerStyle(c.getAttribute("style") ?? "");
  });

  for (const parent of containers) {
    const pid = parent.getAttribute("id");
    if (!pid) continue;
    const children = [...root.children].filter(
      (c) =>
        c.localName === "mxCell" &&
        c.getAttribute("vertex") === "1" &&
        c.getAttribute("parent") === pid,
    );
    if (children.length === 0) continue;

    const pad = 24;
    const style = parent.getAttribute("style") ?? "";
    const header = style.includes("swimlane") ? 36 : 16;
    const cols = Math.max(1, Math.ceil(Math.sqrt(children.length)));
    let maxW = 0;
    let maxH = 0;
    children.forEach((child, i) => {
      const g = readGeometry(child);
      maxW = Math.max(maxW, g.width);
      maxH = Math.max(maxH, g.height);
      const col = i % cols;
      const row = Math.floor(i / cols);
      setCellPosition(
        child,
        pad + col * (g.width + gapX),
        header + pad + row * (g.height + gapY),
      );
    });
    const rows = Math.ceil(children.length / cols);
    const geo = [...parent.children].find((c) => c.localName === "mxGeometry");
    if (geo) {
      geo.setAttribute(
        "width",
        String(
          Math.max(
            Number(geo.getAttribute("width") ?? 0),
            pad * 2 + cols * maxW + (cols - 1) * gapX,
          ),
        ),
      );
      geo.setAttribute(
        "height",
        String(
          Math.max(
            Number(geo.getAttribute("height") ?? 0),
            header + pad * 2 + rows * maxH + (rows - 1) * gapY,
          ),
        ),
      );
    }
  }
}

function applyLayout(ctx: MutableDoc, layout: LayoutInput) {
  if (layout.type === "none") return;

  const { root } = ctx;
  const vertices = collectLayoutVertices(root, layout);
  if (vertices.length === 0) return;

  const originX = layout.origin_x ?? 40;
  const originY = layout.origin_y ?? 40;
  const gapX = layout.gap_x ?? 48;
  const gapY = layout.gap_y ?? 56;
  const direction = layout.direction ?? "top_down";
  const type = resolveLayoutType(root, vertices, layout.type);

  // Prefer laying out non-containers; containers are resized around children after.
  const leafVertices = vertices.filter(
    (c) => !isContainerStyle(c.getAttribute("style") ?? ""),
  );
  const layoutTargets = leafVertices.length > 0 ? leafVertices : vertices;

  if (type === "grid") {
    layoutGrid(layoutTargets, {
      columns: layout.columns ?? Math.min(3, Math.max(1, layoutTargets.length)),
      originX,
      originY,
      gapX,
      gapY,
    });
  } else if (type === "archimate") {
    placeByRanks(archimateRanks(layoutTargets), {
      direction,
      originX,
      originY,
      gapX,
      gapY,
    });
  } else {
    placeByRanks(hierarchicalRanks(root, layoutTargets), {
      direction,
      originX,
      originY,
      gapX,
      gapY,
    });
  }

  layoutNestedChildren(root, Math.min(gapX, 32), Math.min(gapY, 32));
}

export type MutateDiagramInput = {
  page?: string;
  page_settings?: PageSettingsInput;
  add_pages?: { name: string; id?: string }[];
  rename_pages?: { from: string; to: string }[];
  remove?: string[];
  updates?: Omit<UpdateElementInput, "page">[];
  add_nodes?: AddNodeInput[];
  add_edges?: AddEdgeInput[];
  layout?: LayoutInput;
};

export type MutateDiagramResult = {
  xml: string;
  removed: string[];
  updated: string[];
  added_nodes: { id: string; temp_id?: string; label: string }[];
  added_edges: { id: string; source: string; target: string }[];
  added_pages: { id: string; name: string }[];
  renamed_pages: { id: string; name: string }[];
  page_settings_applied: boolean;
  layout_applied: boolean;
};

/**
 * Decide layout for a mutate call.
 * Multi-node creates auto-layout unless layout.type === "none".
 * Explicit layout (except none) always wins.
 */
export function resolveMutateLayout(
  input: MutateDiagramInput,
): LayoutInput | null {
  if (input.layout) {
    if (input.layout.type === "none") return null;
    return {
      direction: "top_down",
      ...input.layout,
    };
  }
  const n = input.add_nodes?.length ?? 0;
  const e = input.add_edges?.length ?? 0;
  if (n >= 2 || (n >= 1 && e >= 1)) {
    return { type: "auto", direction: "top_down" };
  }
  return null;
}

/**
 * Apply many diagram edits in one parse/serialize pass.
 * Order: pages → page_settings → remove → update → add_nodes → add_edges → layout.
 * Edge source/target and node parent may use temp_id from add_nodes in the same call.
 * Multi-node creates get auto layout (top-down / ArchiMate layers) unless layout.type=none.
 */
export async function mutateDiagram(
  xml: string,
  input: MutateDiagramInput,
): Promise<MutateDiagramResult> {
  // Page create/rename may target any page; open default/selected for cell ops.
  const ctx = await openMutable(xml, input.page);
  const aliases = new Map<string, string>();
  const removed: string[] = [];
  const updated: string[] = [];
  const added_nodes: MutateDiagramResult["added_nodes"] = [];
  const added_edges: MutateDiagramResult["added_edges"] = [];
  const added_pages: MutateDiagramResult["added_pages"] = [];
  const renamed_pages: MutateDiagramResult["renamed_pages"] = [];
  const layoutPlan = resolveMutateLayout(input);

  for (const p of input.add_pages ?? []) {
    added_pages.push(applyAddPage(ctx, p));
  }
  for (const p of input.rename_pages ?? []) {
    renamed_pages.push(applyRenamePage(ctx, p));
  }

  let page = input.page;
  if (page) {
    const renamed = (input.rename_pages ?? []).find((r) => r.from === page);
    if (renamed) page = renamed.to;
  }

  const needsCellWork =
    input.page_settings != null ||
    (input.remove?.length ?? 0) > 0 ||
    (input.updates?.length ?? 0) > 0 ||
    (input.add_nodes?.length ?? 0) > 0 ||
    (input.add_edges?.length ?? 0) > 0 ||
    layoutPlan != null;

  const work = needsCellWork
    ? await openMutable(serializeXml(ctx.doc), page)
    : ctx;

  if (input.page_settings) {
    applyPageSettings(work.model, work.root, input.page_settings);
  }

  for (const id of input.remove ?? []) {
    removed.push(...applyRemoveElement(work, id));
  }

  for (const u of input.updates ?? []) {
    updated.push(applyUpdateElement(work, u, aliases));
  }

  for (const n of input.add_nodes ?? []) {
    const parent =
      n.parent && n.parent !== "1" && aliases.has(n.parent)
        ? aliases.get(n.parent)
        : n.parent;
    const id = applyAddNode(work, { ...n, parent });
    if (n.temp_id) {
      if (aliases.has(n.temp_id)) {
        throw new Error(`Duplicate temp_id: ${n.temp_id}`);
      }
      aliases.set(n.temp_id, id);
    }
    added_nodes.push({ id, temp_id: n.temp_id, label: n.label });
  }

  for (const e of input.add_edges ?? []) {
    const id = applyAddEdge(work, e, aliases);
    const source = aliases.get(e.source) ?? e.source;
    const target = aliases.get(e.target) ?? e.target;
    added_edges.push({ id, source, target });
  }

  if (layoutPlan) {
    applyLayout(work, layoutPlan);
  }

  return {
    xml: serializeXml(work.doc),
    removed,
    updated,
    added_nodes,
    added_edges,
    added_pages,
    renamed_pages,
    page_settings_applied: input.page_settings != null,
    layout_applied: layoutPlan != null,
  };
}

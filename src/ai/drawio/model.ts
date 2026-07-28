/**
 * Semantic layer over draw.io mxfile XML for agent tools.
 * Reads uncompressed or deflate-raw+base64 diagram payloads; writes uncompressed mxfile.
 */

export type DrawioShape =
  | "rectangle"
  | "rounded"
  | "ellipse"
  | "rhombus"
  | "cylinder"
  | "actor";

export type DrawioColors = {
  fill_color?: string;
  stroke_color?: string;
  font_color?: string;
};

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
  parent: string;
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
};

export type DrawioElement = DrawioNode | DrawioEdge;

export type DrawioPageSummary = {
  id: string;
  name: string;
  nodes: DrawioNode[];
  edges: DrawioEdge[];
};

export type DrawioDiagramSummary = {
  pages: DrawioPageSummary[];
};

const SHAPE_STYLES: Record<DrawioShape, string> = {
  rectangle: "rounded=0;whiteSpace=wrap;html=1;",
  rounded: "rounded=1;whiteSpace=wrap;html=1;",
  ellipse: "ellipse;whiteSpace=wrap;html=1;aspect=fixed;",
  rhombus: "rhombus;whiteSpace=wrap;html=1;",
  cylinder: "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;",
  actor: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
};

const DEFAULT_EDGE_STYLE =
  "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;";

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
  throw new Error(
    `${field} must be #RGB, #RRGGBB, or none (got: ${raw})`,
  );
}

function parseStyleMap(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of style.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      // Bare tokens like "ellipse" / "rhombus" — keep as key with empty value.
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

export function applyColors(
  baseStyle: string,
  colors: DrawioColors,
): string {
  const map = parseStyleMap(baseStyle);
  if (colors.fill_color != null) {
    map.set("fillColor", normalizeColor(colors.fill_color, "fill_color"));
  }
  if (colors.stroke_color != null) {
    map.set("strokeColor", normalizeColor(colors.stroke_color, "stroke_color"));
  }
  if (colors.font_color != null) {
    map.set("fontColor", normalizeColor(colors.font_color, "font_color"));
  }
  return serializeStyleMap(map);
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
  const stream = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer])
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
    // Not compressed — treat as plain XML fragment if it looks like one after unwrap.
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

    if (cell.getAttribute("edge") === "1") {
      edges.push({
        id,
        kind: "edge",
        label,
        source: cell.getAttribute("source"),
        target: cell.getAttribute("target"),
        style,
        ...colors,
        parent,
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
        parent,
      });
    }
  }

  return {
    id: diagram.getAttribute("id") ?? "",
    name: diagram.getAttribute("name") ?? "Page-1",
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
  diagram: Element;
  model: Element;
  root: Element;
};

async function openMutable(
  xml: string,
  page?: string,
): Promise<MutableDoc> {
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
        d.getAttribute("name") === page ||
        d.getAttribute("id") === page,
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

  return { doc, diagram, model, root };
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
    if (cell.localName === "mxCell" && cell.getAttribute("id") === id) return cell;
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

export type AddNodeInput = {
  label: string;
  shape?: DrawioShape;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: string;
  fill_color?: string;
  stroke_color?: string;
  font_color?: string;
  parent?: string;
  page?: string;
  id?: string;
  /** Alias resolved within the same mutate_diagram call (and for edges). */
  temp_id?: string;
};

function applyAddNode(ctx: MutableDoc, input: AddNodeInput): string {
  const { doc, root } = ctx;
  const id = input.id ?? nextCellId(root);
  if (findCell(root, id)) throw new Error(`Cell id already exists: ${id}`);

  const pos =
    input.x != null && input.y != null
      ? { x: input.x, y: input.y }
      : defaultPosition(root);
  const width = input.width ?? 120;
  const height = input.height ?? 60;
  const base = input.style ?? SHAPE_STYLES[input.shape ?? "rounded"];
  const style = applyColors(base, {
    fill_color: input.fill_color,
    stroke_color: input.stroke_color,
    font_color: input.font_color,
  });

  const cell = doc.createElement("mxCell");
  cell.setAttribute("id", id);
  cell.setAttribute("value", input.label);
  cell.setAttribute("style", style);
  cell.setAttribute("vertex", "1");
  cell.setAttribute("parent", input.parent ?? "1");

  const geo = doc.createElement("mxGeometry");
  geo.setAttribute("x", String(pos.x));
  geo.setAttribute("y", String(pos.y));
  geo.setAttribute("width", String(width));
  geo.setAttribute("height", String(height));
  geo.setAttribute("as", "geometry");
  cell.appendChild(geo);
  root.appendChild(cell);
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

export type AddEdgeInput = {
  source: string;
  target: string;
  label?: string;
  style?: string;
  fill_color?: string;
  stroke_color?: string;
  font_color?: string;
  page?: string;
  id?: string;
};

function resolveRef(
  ref: string,
  aliases: Map<string, string>,
  root: Element,
  kind: "source" | "target",
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

  const style = applyColors(input.style ?? DEFAULT_EDGE_STYLE, {
    fill_color: input.fill_color,
    stroke_color: input.stroke_color,
    font_color: input.font_color,
  });

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

export type UpdateElementInput = {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  style?: string;
  fill_color?: string;
  stroke_color?: string;
  font_color?: string;
  source?: string;
  target?: string;
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
  if (
    input.style != null ||
    input.fill_color != null ||
    input.stroke_color != null ||
    input.font_color != null
  ) {
    const base = input.style ?? cell.getAttribute("style") ?? "";
    cell.setAttribute(
      "style",
      applyColors(base, {
        fill_color: input.fill_color,
        stroke_color: input.stroke_color,
        font_color: input.font_color,
      }),
    );
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

function applyRemoveElement(ctx: MutableDoc, id: string): string[] {
  const { root } = ctx;
  const cell = findCell(root, id);
  if (!cell) throw new Error(`Cell not found: ${id}`);

  const removed = [id];
  if (cell.getAttribute("vertex") === "1") {
    for (const other of [...root.children]) {
      if (other.localName !== "mxCell") continue;
      if (other.getAttribute("edge") !== "1") continue;
      const src = other.getAttribute("source");
      const tgt = other.getAttribute("target");
      if (src === id || tgt === id) {
        const eid = other.getAttribute("id");
        if (eid) removed.push(eid);
        root.removeChild(other);
      }
    }
  }
  root.removeChild(cell);
  return removed;
}

export async function removeElement(
  xml: string,
  opts: { id: string; page?: string },
): Promise<{ xml: string; removed: string[]; id: string }> {
  const ctx = await openMutable(xml, opts.page);
  const removed = applyRemoveElement(ctx, opts.id);
  return { xml: serializeXml(ctx.doc), removed, id: opts.id };
}

export type MutateDiagramInput = {
  page?: string;
  remove?: string[];
  updates?: Omit<UpdateElementInput, "page">[];
  add_nodes?: AddNodeInput[];
  add_edges?: AddEdgeInput[];
};

export type MutateDiagramResult = {
  xml: string;
  removed: string[];
  updated: string[];
  added_nodes: { id: string; temp_id?: string; label: string }[];
  added_edges: { id: string; source: string; target: string }[];
};

/**
 * Apply many diagram edits in one parse/serialize pass.
 * Order: remove → update → add_nodes → add_edges.
 * Edge source/target may use temp_id from add_nodes in the same call.
 */
export async function mutateDiagram(
  xml: string,
  input: MutateDiagramInput,
): Promise<MutateDiagramResult> {
  const ctx = await openMutable(xml, input.page);
  const aliases = new Map<string, string>();
  const removed: string[] = [];
  const updated: string[] = [];
  const added_nodes: MutateDiagramResult["added_nodes"] = [];
  const added_edges: MutateDiagramResult["added_edges"] = [];

  for (const id of input.remove ?? []) {
    removed.push(...applyRemoveElement(ctx, id));
  }
  for (const u of input.updates ?? []) {
    updated.push(applyUpdateElement(ctx, u, aliases));
  }
  for (const n of input.add_nodes ?? []) {
    const id = applyAddNode(ctx, n);
    if (n.temp_id) {
      if (aliases.has(n.temp_id)) {
        throw new Error(`Duplicate temp_id: ${n.temp_id}`);
      }
      aliases.set(n.temp_id, id);
    }
    added_nodes.push({ id, temp_id: n.temp_id, label: n.label });
  }
  for (const e of input.add_edges ?? []) {
    const id = applyAddEdge(ctx, e, aliases);
    const source = aliases.get(e.source) ?? e.source;
    const target = aliases.get(e.target) ?? e.target;
    added_edges.push({ id, source, target });
  }

  return {
    xml: serializeXml(ctx.doc),
    removed,
    updated,
    added_nodes,
    added_edges,
  };
}

export { SHAPE_STYLES, DEFAULT_EDGE_STYLE };

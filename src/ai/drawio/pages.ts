/** Page-level mxfile helpers (TS port of @drawio/mcp pages.js, no fs). */

const DIAGRAM_RE = /<diagram\b([^>]*?)(?:\/>|>([\s\S]*?)<\/diagram>)/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

export type DrawioPageMeta = {
  index: number;
  id: string | null;
  name: string | null;
  approxSizeBytes: number;
};

type ParsedDiagram = {
  index: number;
  attrs: Record<string, string>;
  body: string;
  start: number;
  end: number;
};

export function assertDrawioFilePath(path: string): string {
  const p = path.trim();
  const lower = p.toLowerCase();
  if (!lower.endsWith(".drawio") && !lower.endsWith(".xml")) {
    throw new Error(`Expected a .drawio path, got: ${path}`);
  }
  return p;
}

function parseAttrs(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
    attrs[match[1]!] = match[2]!;
  }
  return attrs;
}

export function parseDiagrams(mxfileText: string): ParsedDiagram[] {
  const diagrams: ParsedDiagram[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  DIAGRAM_RE.lastIndex = 0;
  while ((match = DIAGRAM_RE.exec(mxfileText)) !== null) {
    diagrams.push({
      index: index++,
      attrs: parseAttrs(match[1] ?? ""),
      body: match[2] || "",
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return diagrams;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function listPageMeta(mxfileText: string): DrawioPageMeta[] {
  return parseDiagrams(mxfileText).map((diagram) => ({
    index: diagram.index,
    id: diagram.attrs.id || null,
    name: diagram.attrs.name || null,
    approxSizeBytes: utf8ByteLength(diagram.body),
  }));
}

export function isLikelyCompressed(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && !trimmed.startsWith("<");
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

async function pipeBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const buf = await new Response(input.pipeThrough(transform)).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflateRawToString(data: Uint8Array): Promise<string> {
  const out = await pipeBytes(data, new DecompressionStream("deflate-raw"));
  if (out.byteLength > MAX_INFLATED_BYTES) {
    throw new Error(`decompressed page exceeds the ${MAX_INFLATED_BYTES} byte limit`);
  }
  return new TextDecoder().decode(out);
}

export async function decompressDiagram(body: string): Promise<string> {
  const trimmed = body.trim();
  if (!isLikelyCompressed(trimmed)) return trimmed;
  try {
    const inflated = await inflateRawToString(b64ToBytes(trimmed));
    try {
      return decodeURIComponent(inflated);
    } catch {
      return inflated;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to decompress page content: ${msg}`);
  }
}

export async function compressDiagram(xml: string): Promise<string> {
  const encoded = new TextEncoder().encode(encodeURIComponent(xml));
  const compressed = await pipeBytes(
    encoded,
    new CompressionStream("deflate-raw"),
  );
  return bytesToB64(compressed);
}

export function findPage(diagrams: ParsedDiagram[], pageRef: string): ParsedDiagram {
  const asString = String(pageRef);
  if (/^\d+$/.test(asString)) {
    const idx = Number.parseInt(asString, 10);
    if (idx < 0 || idx >= diagrams.length) {
      throw new Error(
        `Page index ${idx} out of range (file has ${diagrams.length} page${diagrams.length === 1 ? "" : "s"})`,
      );
    }
    return diagrams[idx]!;
  }

  let matches = diagrams.filter((d) => d.attrs.name === asString);
  if (matches.length === 0) {
    matches = diagrams.filter((d) => d.attrs.id === asString);
  }
  if (matches.length === 0) {
    const names = diagrams.map((d) => d.attrs.name).join(", ");
    throw new Error(
      `No page with name or id "${asString}" found. Available page names: ${names}`,
    );
  }
  if (matches.length > 1) {
    const indices = matches.map((d) => d.index).join(", ");
    throw new Error(
      `Multiple pages named "${asString}" found (indices: ${indices}). Use an index or page id instead.`,
    );
  }
  return matches[0]!;
}

export async function readPageXmlFromText(
  mxfileText: string,
  pageRef: string,
): Promise<{ xml: string; index: number; id: string | null; name: string | null }> {
  const diagrams = parseDiagrams(mxfileText);
  if (diagrams.length === 0) throw new Error("mxfile has no diagram pages");
  const page = findPage(diagrams, pageRef);
  const xml = await decompressDiagram(page.body);
  return {
    xml,
    index: page.index,
    id: page.attrs.id || null,
    name: page.attrs.name || null,
  };
}

function assertMxGraphModel(newXml: string): string {
  const trimmedXml = newXml.trim();
  if (!trimmedXml.startsWith("<mxGraphModel")) {
    throw new Error(
      "set_page content must be plain <mxGraphModel> XML for a single page, not a full <mxfile> or non-XML content",
    );
  }
  if (/<\/?diagram\b/i.test(trimmedXml)) {
    throw new Error(
      "set_page content must not contain <diagram> tags — pass the inner mxGraphModel XML of a single page",
    );
  }
  return trimmedXml;
}

export async function writePageXmlInText(
  mxfileText: string,
  pageRef: string,
  newXml: string,
): Promise<{
  xml: string;
  index: number;
  id: string | null;
  name: string | null;
  compressed: boolean;
}> {
  const diagrams = parseDiagrams(mxfileText);
  if (diagrams.length === 0) throw new Error("mxfile has no diagram pages");
  const page = findPage(diagrams, pageRef);
  const trimmedXml = assertMxGraphModel(newXml);
  const compressed = isLikelyCompressed(page.body);
  const newBody = compressed ? await compressDiagram(trimmedXml) : trimmedXml;

  const fullOriginal = mxfileText.slice(page.start, page.end);
  let replacement: string;
  if (fullOriginal.endsWith("/>")) {
    replacement = `${fullOriginal.slice(0, -2)}>${newBody}</diagram>`;
  } else {
    const bodyStartOffset = fullOriginal.indexOf(">") + 1;
    const bodyEndOffset = fullOriginal.lastIndexOf("</diagram>");
    replacement =
      fullOriginal.slice(0, bodyStartOffset) +
      newBody +
      fullOriginal.slice(bodyEndOffset);
  }

  return {
    xml: mxfileText.slice(0, page.start) + replacement + mxfileText.slice(page.end),
    index: page.index,
    id: page.attrs.id || null,
    name: page.attrs.name || null,
    compressed,
  };
}

/** True if the page has no vertex cells (empty first-paint target). */
export function mxGraphModelIsEmpty(modelXml: string): boolean {
  return !/<mxCell\b[^>]*\bvertex="1"/i.test(modelXml);
}

export async function mxfilePageIsEmpty(
  mxfileText: string,
  pageRef = "0",
): Promise<boolean> {
  const { xml } = await readPageXmlFromText(mxfileText, pageRef);
  return mxGraphModelIsEmpty(xml);
}

/**
 * Accept a full mxfile or a single mxGraphModel and return a vault mxfile.
 */
export function wrapContentAsMxfile(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("xml content is empty");
  if (/<mxfile[\s>]/i.test(trimmed)) {
    if (parseDiagrams(trimmed).length === 0) {
      throw new Error("mxfile has no diagram pages");
    }
    return trimmed;
  }
  if (!trimmed.startsWith("<mxGraphModel")) {
    throw new Error(
      "xml must be a full <mxfile> or a single <mxGraphModel> element",
    );
  }
  if (/<\/?diagram\b/i.test(trimmed)) {
    throw new Error("mxGraphModel xml must not contain <diagram> tags");
  }
  return `<mxfile host="MarkSpace" agent="MarkSpace" version="28.2.5" type="device">
  <diagram id="page-1" name="Page-1">
    ${trimmed}
  </diagram>
</mxfile>
`;
}

export function extractMxGraphModel(xml: string): string {
  const trimmed = xml.trim();
  if (trimmed.startsWith("<mxGraphModel")) return trimmed;
  const match = /<mxGraphModel\b[\s\S]*<\/mxGraphModel>/i.exec(trimmed);
  if (!match) {
    throw new Error("Converted diagram has no mxGraphModel");
  }
  return match[0];
}

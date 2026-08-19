const SVG_NS = "http://www.w3.org/2000/svg";
/** Keep clipboard rasters small — huge canvases freeze WebKitGTK. */
const MAX_EDGE = 2048;
const DEFAULT_SCALE = 2;
const LOAD_TIMEOUT_MS = 8000;

export function intrinsicSvgSize(svg: SVGSVGElement): {
  width: number;
  height: number;
} {
  const baseW = Number(svg.dataset.baseW);
  const baseH = Number(svg.dataset.baseH);
  if (baseW > 0 && baseH > 0) return { width: baseW, height: baseH };

  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n)) &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] };
    }
  }

  const attrW = parseFloat(svg.getAttribute("width") || "");
  const attrH = parseFloat(svg.getAttribute("height") || "");
  if (attrW > 0 && attrH > 0) return { width: attrW, height: attrH };

  const rect = svg.getBoundingClientRect();
  return {
    width: Math.max(1, rect.width || 1),
    height: Math.max(1, rect.height || 1),
  };
}

function labelPlainText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("br").forEach((br) => {
    br.replaceWith("\n");
  });
  return (clone.textContent ?? "").replace(/\u00a0/g, " ").trim();
}

/**
 * Mermaid htmlLabels use foreignObject; WebKit hangs when those are drawn via
 * Image → canvas. Replace with plain SVG <text> (single line, centered).
 */
function replaceForeignObjects(live: SVGSVGElement, clone: SVGSVGElement) {
  const sources = [...live.querySelectorAll("foreignObject")];
  const targets = [...clone.querySelectorAll("foreignObject")];

  sources.forEach((src, index) => {
    const dst = targets[index];
    if (!dst) return;

    const x = parseFloat(src.getAttribute("x") || "0") || 0;
    const y = parseFloat(src.getAttribute("y") || "0") || 0;
    const boxW = parseFloat(src.getAttribute("width") || "0") || 0;
    const boxH = parseFloat(src.getAttribute("height") || "0") || 0;
    const label = src.querySelector("div, p, span, a, td, th") ?? src;
    const text = labelPlainText(label);
    if (!text) {
      dst.remove();
      return;
    }

    let fontSize = 12;
    let fill = "#27272a";
    let fontFamily = "sans-serif";
    let fontWeight = "";
    let fontStyle = "";
    try {
      const style = getComputedStyle(label);
      fontSize = Math.max(1, parseFloat(style.fontSize) || 12);
      fill = style.color || fill;
      fontFamily = style.fontFamily || fontFamily;
      fontWeight = style.fontWeight || "";
      fontStyle = style.fontStyle && style.fontStyle !== "normal" ? style.fontStyle : "";
    } catch {
      // keep defaults
    }

    const node = document.createElementNS(SVG_NS, "text");
    node.setAttribute("x", String(x + boxW / 2));
    node.setAttribute("y", String(y + boxH / 2));
    node.setAttribute("text-anchor", "middle");
    node.setAttribute("dominant-baseline", "middle");
    node.setAttribute("fill", fill);
    node.setAttribute("font-size", String(fontSize));
    node.setAttribute("font-family", fontFamily);
    if (fontWeight) node.setAttribute("font-weight", fontWeight);
    if (fontStyle) node.setAttribute("font-style", fontStyle);
    // One line — avoid wrap measurement / canvas getContext in this path.
    node.textContent = text.replace(/\s+/g, " ");
    dst.replaceWith(node);
  });

  // Safety: any leftover FO will freeze WebKit on drawImage.
  clone.querySelectorAll("foreignObject").forEach((el) => el.remove());
}

/** Clone an on-screen SVG into a self-contained snapshot suitable for PNG rasterization. */
export function prepareSvgForClipboard(
  svg: SVGSVGElement,
  scale = 1,
): SVGSVGElement {
  const { width, height } = intrinsicSvgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.removeAttribute("style");
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  clone.setAttribute("width", String(outW));
  clone.setAttribute("height", String(outH));
  replaceForeignObjects(svg, clone);
  clone.querySelectorAll("script").forEach((el) => el.remove());
  return clone;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function clipboardScale(width: number, height: number): number {
  const maxDim = Math.max(width, height);
  if (!(maxDim > 0) || !Number.isFinite(maxDim)) return 1;
  const scale = DEFAULT_SCALE;
  if (maxDim * scale <= MAX_EDGE) return scale;
  return Math.max(0.25, MAX_EDGE / maxDim);
}

/** Bitmaps: never upscale (unlike SVG). Only shrink so the canvas stays ≤ MAX_EDGE. */
function bitmapClipboardScale(width: number, height: number): number {
  const maxDim = Math.max(width, height);
  if (!(maxDim > 0) || !Number.isFinite(maxDim) || maxDim <= MAX_EDGE) return 1;
  return MAX_EDGE / maxDim;
}

function loadImageFromUrl(
  url: string,
  revokeUrl: boolean,
  errorMessage: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      if (revokeUrl) URL.revokeObjectURL(url);
      reject(new Error("Image rasterize timed out"));
    }, LOAD_TIMEOUT_MS);
    image.onload = () => {
      window.clearTimeout(timer);
      if (revokeUrl) URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      if (revokeUrl) URL.revokeObjectURL(url);
      reject(new Error(errorMessage));
    };
    image.src = url;
  });
}

function loadSvgImage(markup: string): Promise<HTMLImageElement> {
  // Blob URL avoids encodeURIComponent freezing on large Mermaid markup.
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  return loadImageFromUrl(url, true, "Failed to rasterize SVG");
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/** Width/height from PNG IHDR — no decode, so huge files stay off the canvas path. */
export function pngPixelSize(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (!isPngBytes(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function sniffImageMime(bytes: Uint8Array): string {
  if (isPngBytes(bytes)) return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 256))
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("PNG encode failed"));
          return;
        }
        void blob.arrayBuffer().then(
          (buf) => resolve(new Uint8Array(buf)),
          reject,
        );
      },
      "image/png",
    );
  });
}

/** Rasterize a live SVG element to PNG bytes (avoids huge RGBA IPC). */
export async function rasterizeSvgElementToPng(
  svg: SVGSVGElement,
  opts?: { background?: string },
): Promise<Uint8Array> {
  const { width, height } = intrinsicSvgSize(svg);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Invalid SVG size");
  }
  const scale = clipboardScale(width, height);
  const prepared = prepareSvgForClipboard(svg, scale);
  const markup = new XMLSerializer().serializeToString(prepared);
  // Let the UI breathe between sync clone/serialize and image decode.
  await yieldToUi();
  const image = await loadSvgImage(markup);

  const outW = Math.max(
    1,
    Math.min(MAX_EDGE, image.naturalWidth || Math.round(width * scale)),
  );
  const outH = Math.max(
    1,
    Math.min(MAX_EDGE, image.naturalHeight || Math.round(height * scale)),
  );

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = opts?.background ?? "#ffffff";
  context.fillRect(0, 0, outW, outH);
  context.drawImage(image, 0, 0, outW, outH);
  await yieldToUi();
  return canvasToPngBytes(canvas);
}

/** Rasterize a bitmap to PNG bytes, capped so huge canvases don't freeze WebKitGTK. */
export async function rasterizeHtmlImageToPng(
  image: HTMLImageElement,
): Promise<Uint8Array> {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!(width > 0) || !(height > 0)) {
    throw new Error("Invalid image size");
  }
  const scale = bitmapClipboardScale(width, height);
  const outW = Math.max(1, Math.min(MAX_EDGE, Math.round(width * scale)));
  const outH = Math.max(1, Math.min(MAX_EDGE, Math.round(height * scale)));

  await yieldToUi();
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(image, 0, 0, outW, outH);
  await yieldToUi();
  return canvasToPngBytes(canvas);
}

/**
 * Encode file bytes as PNG for the clipboard.
 * Asset-protocol images taint canvas if drawn directly; a blob URL does not.
 * Huge sources are downscaled to MAX_EDGE — same cap as diagram copy.
 */
export async function rasterizeImageBytesToPng(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const png = pngPixelSize(bytes);
  if (png && Math.max(png.width, png.height) <= MAX_EDGE) {
    return copyBytes(bytes);
  }

  await yieldToUi();
  const mime = sniffImageMime(bytes);
  const blob = new Blob([copyBytes(bytes)], {
    type: mime === "application/octet-stream" ? "image/png" : mime,
  });
  const url = URL.createObjectURL(blob);
  const image = await loadImageFromUrl(url, true, "Failed to decode image");
  return rasterizeHtmlImageToPng(image);
}

/** @deprecated Prefer rasterizeSvgElementToPng — kept for tests of size helpers. */
export async function rasterizeSvgElement(
  svg: SVGSVGElement,
  opts?: { background?: string },
): Promise<ImageData> {
  const { width, height } = intrinsicSvgSize(svg);
  const scale = clipboardScale(width, height);
  const prepared = prepareSvgForClipboard(svg, scale);
  const markup = new XMLSerializer().serializeToString(prepared);
  const image = await loadSvgImage(markup);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.min(MAX_EDGE, image.naturalWidth || Math.round(width * scale)));
  canvas.height = Math.max(
    1,
    Math.min(MAX_EDGE, image.naturalHeight || Math.round(height * scale)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = opts?.background ?? "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

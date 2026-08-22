import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
  type DiagramSkin,
} from "../diagramCache";
import { rewriteWikiLinksInD2Source } from "./d2WikiLinks";

type D2Instance = {
  compile: (
    input: string,
    options?: Record<string, unknown>,
  ) => Promise<{
    diagram: unknown;
    renderOptions: Record<string, unknown>;
  }>;
  render: (
    diagram: unknown,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

let d2Ready: Promise<D2Instance> | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();
let renderSeq = 0;

/**
 * Load D2 as a static asset URL (no Vite transform of the ~8MB WASM bundle).
 * Transforming that file breaks the inlined worker and surfaces as hangs /
 * opaque `[object Object]` errors in the editor.
 */
function loadD2(): Promise<D2Instance> {
  if (!d2Ready) {
    d2Ready = (async () => {
      // Relative ?url import (not package exports) so Rollup emits the file
      // as an asset without parsing/transforming it.
      const { default: url } =
        await import("../../../node_modules/@terrastruct/d2/dist/browser/index.js?url");
      const mod = (await import(/* @vite-ignore */ url)) as {
        D2: new () => D2Instance;
      };
      return new mod.D2();
    })();
  }
  return d2Ready;
}

/** D2 theme IDs: 0 default, 200 dark mauve; 4 Neutral grey for chat. */
function themeIds(
  dark: boolean,
  skin: DiagramSkin,
): {
  themeID: number;
} {
  if (skin === "neutral") {
    return dark ? { themeID: 200 } : { themeID: 4 };
  }
  return dark ? { themeID: 200 } : { themeID: 0 };
}

function formatD2Error(err: unknown): string {
  if (err instanceof Error) return formatD2Error(err.message || String(err));
  if (typeof err === "string") {
    // Compile failures arrive as a JSON array of {range, errmsg}.
    const trimmed = err.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return formatD2Error(JSON.parse(trimmed));
      } catch {
        /* not JSON — use as-is */
      }
    }
    return err;
  }
  if (Array.isArray(err)) {
    return err
      .map((e) => formatD2Error(e))
      .filter(Boolean)
      .join("\n");
  }
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.errmsg === "string") return rec.errmsg;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.error === "string") return rec.error;
    if (Array.isArray(rec.errs) && rec.errs.length)
      return formatD2Error(rec.errs);
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

function ensureSvgString(out: unknown): string {
  if (typeof out === "string") {
    if (!out.includes("<svg")) {
      throw new Error(`D2 render did not return SVG (${out.slice(0, 120)})`);
    }
    return out;
  }
  if (out && typeof out === "object") {
    const rec = out as Record<string, unknown>;
    if (typeof rec.svg === "string") return ensureSvgString(rec.svg);
    if (typeof rec.data === "string") return ensureSvgString(rec.data);
  }
  throw new Error(`D2 render returned ${typeof out}: ${formatD2Error(out)}`);
}

/**
 * D2's root <svg> carries only a viewBox, so inline previews (`height: auto`)
 * collapse to zero height. Give it intrinsic size from the viewBox.
 */
function withIntrinsicSize(svg: string): string {
  const openTag = svg.match(/<svg\b[^>]*>/);
  if (!openTag) return svg;
  const tag = openTag[0];
  if (/\swidth\s*=/.test(tag) && /\sheight\s*=/.test(tag)) return svg;
  const viewBox = tag.match(/\sviewBox\s*=\s*"([^"]+)"/);
  if (!viewBox) return svg;
  const parts = viewBox[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every((n) => Number.isFinite(n))) return svg;
  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return svg;
  const at = openTag.index ?? 0;
  const sized = `<svg width="${width}" height="${height}"${tag.slice(4)}`;
  return svg.slice(0, at) + sized + svg.slice(at + tag.length);
}

const TIMEOUT_MS = 20_000;

/** The worker never rejects on its own; without this a block hangs on "Rendering…". */
function withTimeout<T>(work: Promise<T>, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`D2 ${stage} timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function renderD2Uncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
): Promise<string> {
  const task = async () => {
    try {
      const d2 = await loadD2();
      const themes = themeIds(dark, skin);
      renderSeq += 1;
      const result = await withTimeout(
        d2.compile(rewriteWikiLinksInD2Source(code), themes),
        "compile",
      );
      const out = await withTimeout(
        d2.render(result.diagram, {
          ...result.renderOptions,
          ...themes,
          noXMLTag: true,
          pad: 20,
          salt: `ms-d2-${renderSeq}`,
        }),
        "render",
      );
      return withIntrinsicSize(ensureSvgString(out));
    } catch (err) {
      throw new Error(formatD2Error(err));
    }
  };

  // Serialize — the D2 worker wrapper keeps a single pending resolver, so
  // concurrent compile/render calls resolve each other's promises.
  const result = renderQueue.then(task, task);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function renderD2ToSvg(
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  const trimmed = code.trim();
  const key = diagramCacheKey("d2", trimmed, dark, skin);
  return getOrRenderDiagramSvg(key, () =>
    renderD2Uncached(trimmed, dark, skin),
  );
}

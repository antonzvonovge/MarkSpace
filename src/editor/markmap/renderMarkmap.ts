import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
  type DiagramSkin,
} from "../diagramCache";

const SVG_W = 960;
const SVG_H = 640;

let libsReady: Promise<{
  Transformer: typeof import("markmap-lib").Transformer;
  Markmap: typeof import("markmap-view").Markmap;
  deriveOptions: typeof import("markmap-view").deriveOptions;
}> | null = null;

function loadMarkmap() {
  if (!libsReady) {
    libsReady = Promise.all([
      import("markmap-lib"),
      import("markmap-view"),
    ]).then(([lib, view]) => ({
      Transformer: lib.Transformer,
      Markmap: view.Markmap,
      deriveOptions: view.deriveOptions,
    }));
  }
  return libsReady;
}

function colorOpts(dark: boolean, skin: DiagramSkin) {
  if (skin === "neutral") {
    return dark
      ? {
          colorFreezeLevel: 2,
          color: ["#a1a1aa", "#71717a", "#52525b", "#3f3f46"],
        }
      : {
          colorFreezeLevel: 2,
          color: ["#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"],
        };
  }
  return dark
    ? {
        colorFreezeLevel: 2,
        color: ["#cb11ab", "#a78bfa", "#38bdf8", "#34d399", "#fbbf24"],
      }
    : {
        colorFreezeLevel: 2,
        color: ["#cb11ab", "#7c3aed", "#0284c7", "#059669", "#d97706"],
      };
}

async function renderMarkmapUncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
): Promise<string> {
  const { Transformer, Markmap, deriveOptions } = await loadMarkmap();
  const transformer = new Transformer();
  const { root } = transformer.transform(code);
  if (!root) {
    throw new Error("Markmap produced an empty tree");
  }

  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;opacity:0";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(SVG_W));
  svg.setAttribute("height", String(SVG_H));
  host.appendChild(svg);
  document.body.appendChild(host);

  try {
    const options = deriveOptions(colorOpts(dark, skin));
    const mm = Markmap.create(svg, options, root);
    await mm.fit();
    // Give d3 a frame to settle transforms before serializing.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    const serialized = new XMLSerializer().serializeToString(svg);
    mm.destroy();
    return serialized;
  } finally {
    host.remove();
  }
}

export function renderMarkmapToSvg(
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  const trimmed = code.trim();
  const key = diagramCacheKey("markmap", trimmed, dark, skin);
  return getOrRenderDiagramSvg(key, () =>
    renderMarkmapUncached(trimmed, dark, skin),
  );
}

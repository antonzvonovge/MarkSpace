import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
  type DiagramSkin,
} from "../diagramCache";

type VizModule = typeof import("@viz-js/viz");
type VizInstance = Awaited<ReturnType<VizModule["instance"]>>;

let vizReady: Promise<VizInstance> | null = null;

function loadViz(): Promise<VizInstance> {
  if (!vizReady) {
    vizReady = import("@viz-js/viz").then((mod) => mod.instance());
  }
  return vizReady;
}

function themeAttrs(
  dark: boolean,
  skin: DiagramSkin,
): {
  graphAttributes?: Record<string, string | number | boolean>;
  nodeAttributes?: Record<string, string | number | boolean>;
  edgeAttributes?: Record<string, string | number | boolean>;
} {
  if (skin === "neutral") {
    if (dark) {
      return {
        graphAttributes: {
          bgcolor: "transparent",
          fontname: "sans-serif",
          fontsize: "10",
        },
        nodeAttributes: {
          style: "filled",
          fillcolor: "#27272a",
          fontcolor: "#e4e4e7",
          color: "#52525b",
          fontname: "sans-serif",
          fontsize: "10",
        },
        edgeAttributes: {
          color: "#71717a",
          fontcolor: "#a1a1aa",
          fontname: "sans-serif",
          fontsize: "9",
        },
      };
    }
    return {
      graphAttributes: {
        bgcolor: "transparent",
        fontname: "sans-serif",
        fontsize: "10",
      },
      nodeAttributes: {
        style: "filled",
        fillcolor: "#f4f4f5",
        fontcolor: "#3f3f46",
        color: "#d4d4d8",
        fontname: "sans-serif",
        fontsize: "10",
      },
      edgeAttributes: {
        color: "#a1a1aa",
        fontcolor: "#52525b",
        fontname: "sans-serif",
        fontsize: "9",
      },
    };
  }
  if (dark) {
    return {
      graphAttributes: { bgcolor: "transparent" },
      nodeAttributes: {
        style: "filled",
        fillcolor: "#1e293b",
        fontcolor: "#e2e8f0",
        color: "#64748b",
      },
      edgeAttributes: { color: "#94a3b8", fontcolor: "#cbd5e1" },
    };
  }
  return {
    graphAttributes: { bgcolor: "transparent" },
  };
}

async function renderDotUncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
): Promise<string> {
  const viz = await loadViz();
  return viz.renderString(code, {
    format: "svg",
    ...themeAttrs(dark, skin),
  });
}

export function renderDotToSvg(
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  const trimmed = code.trim();
  const key = diagramCacheKey("dot", trimmed, dark, skin);
  return getOrRenderDiagramSvg(key, () =>
    renderDotUncached(trimmed, dark, skin),
  );
}

import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
} from "../diagramCache";

let mermaidReady: Promise<typeof import("mermaid")> | null = null;
let lastTheme: "dark" | "default" | null = null;

function loadMermaid() {
  if (!mermaidReady) mermaidReady = import("mermaid");
  return mermaidReady;
}

async function renderMermaidUncached(
  code: string,
  dark: boolean,
  renderId: string,
): Promise<string> {
  const { default: mermaid } = await loadMermaid();
  const theme = dark ? "dark" : "default";
  if (lastTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
    });
    lastTheme = theme;
  }
  const { svg } = await mermaid.render(renderId, code);
  return svg;
}

let renderSeq = 0;

export function renderMermaidToSvg(
  code: string,
  dark: boolean,
): Promise<string> {
  const key = diagramCacheKey("mermaid", code.trim(), dark);
  return getOrRenderDiagramSvg(key, () => {
    renderSeq += 1;
    const renderId = `ms-mermaid-${renderSeq}-${Date.now()}`;
    return renderMermaidUncached(code.trim(), dark, renderId);
  });
}

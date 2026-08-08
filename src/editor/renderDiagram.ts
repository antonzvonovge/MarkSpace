import type { DiagramEngine, DiagramSkin } from "./diagramCache";
import { renderD2ToSvg } from "./d2/renderD2";
import { renderDotToSvg } from "./dot/renderDot";
import { renderMarkmapToSvg } from "./markmap/renderMarkmap";
import { renderMermaidToSvg } from "./mermaid/renderMermaid";
import { renderPlantUmlToSvg } from "./plantuml/renderPlantUml";

export type DiagramRenderFn = (
  code: string,
  dark: boolean,
  skin: DiagramSkin,
) => Promise<string>;

const RENDERERS: Record<DiagramEngine, DiagramRenderFn> = {
  mermaid: renderMermaidToSvg,
  plantuml: renderPlantUmlToSvg,
  d2: renderD2ToSvg,
  dot: renderDotToSvg,
  markmap: renderMarkmapToSvg,
};

/** Fence language tag → diagram engine (aliases included). */
export const DIAGRAM_LANGS: Record<string, DiagramEngine> = {
  mermaid: "mermaid",
  plantuml: "plantuml",
  puml: "plantuml",
  d2: "d2",
  dot: "dot",
  graphviz: "dot",
  markmap: "markmap",
};

export function diagramEngineForLang(
  lang: string | undefined,
): DiagramEngine | null {
  if (!lang) return null;
  return DIAGRAM_LANGS[lang.toLowerCase()] ?? null;
}

export function renderDiagramToSvg(
  engine: DiagramEngine,
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  return RENDERERS[engine](code, dark, skin);
}

export function diagramRenderFn(engine: DiagramEngine): DiagramRenderFn {
  return RENDERERS[engine];
}

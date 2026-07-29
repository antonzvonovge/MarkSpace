import vizUrl from "@plantuml/core/viz-global.js?url";
import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
  type DiagramSkin,
} from "../diagramCache";

type RenderToString = (
  lines: string[],
  onSuccess: (svg: string) => void,
  onError: (message: string) => void,
  options?: { dark?: boolean },
) => void;

let vizReady: Promise<void> | null = null;
let plantumlApi: { renderToString: RenderToString } | null = null;
let renderQueue: Promise<unknown> = Promise.resolve();

function loadVizScript(): Promise<void> {
  if (vizReady) return vizReady;
  vizReady = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector("script[data-plantuml-viz]");
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = vizUrl;
    script.async = true;
    script.dataset.plantumlViz = "1";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load PlantUML Graphviz engine"));
    document.head.appendChild(script);
  });
  return vizReady;
}

async function getPlantUmlApi() {
  if (plantumlApi) return plantumlApi;
  await loadVizScript();
  const mod = await import("@plantuml/core");
  plantumlApi = mod as { renderToString: RenderToString };
  return plantumlApi;
}

/** Ensure @startuml / @enduml wrappers when the user omitted them. */
export function normalizePlantUmlSource(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return trimmed;
  if (/@start\w+/i.test(trimmed)) return trimmed;
  return `@startuml\n${trimmed}\n@enduml`;
}

const NEUTRAL_SKINPARAMS_LIGHT = `skinparam shadowing false
skinparam monochrome true
skinparam backgroundColor transparent
<style>
root {
  FontSize 9
  RoundCorner 3
  LineThickness 1
  Padding 6
  Margin 4
}
arrow {
  LineThickness 1
}
</style>
`;

const NEUTRAL_SKINPARAMS_DARK = `skinparam shadowing false
skinparam monochrome reverse
skinparam backgroundColor transparent
<style>
root {
  FontSize 9
  RoundCorner 3
  LineThickness 1
  Padding 6
  Margin 4
}
arrow {
  LineThickness 1
}
</style>
`;

/** Inject compact monochrome skinparams for chat (after @start line). */
export function applyPlantUmlSkin(
  code: string,
  skin: DiagramSkin,
  dark: boolean,
): string {
  const source = normalizePlantUmlSource(code);
  if (skin !== "neutral") return source;
  if (/skinparam\s+monochrome/i.test(source)) return source;

  const block = dark ? NEUTRAL_SKINPARAMS_DARK : NEUTRAL_SKINPARAMS_LIGHT;
  return source.replace(/(@start\w+[^\n]*\n)/i, `$1${block}`);
}

function renderPlantUmlUncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
): Promise<string> {
  const task = async () => {
    const { renderToString } = await getPlantUmlApi();
    const source = applyPlantUmlSkin(code, skin, dark);
    const lines = source.split(/\r\n|\r|\n/);
    // Neutral chat palette owns colors; skip engine dark mode to avoid neon.
    const useEngineDark = skin === "default" && dark;
    return new Promise<string>((resolve, reject) => {
      renderToString(
        lines,
        (svg) => resolve(svg),
        (message) => reject(new Error(message || "PlantUML render failed")),
        useEngineDark ? { dark: true } : undefined,
      );
    });
  };

  // Serialize — shared engine state overwrites concurrent renders.
  const result = renderQueue.then(task, task);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function renderPlantUmlToSvg(
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  const source = applyPlantUmlSkin(code.trim(), skin, dark);
  const key = diagramCacheKey("plantuml", source, dark, skin);
  return getOrRenderDiagramSvg(key, () =>
    renderPlantUmlUncached(code.trim(), dark, skin),
  );
}

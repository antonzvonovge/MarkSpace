import vizUrl from "@plantuml/core/viz-global.js?url";
import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
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

function renderPlantUmlUncached(
  code: string,
  dark: boolean,
): Promise<string> {
  const task = async () => {
    const { renderToString } = await getPlantUmlApi();
    const source = normalizePlantUmlSource(code);
    const lines = source.split(/\r\n|\r|\n/);
    return new Promise<string>((resolve, reject) => {
      renderToString(
        lines,
        (svg) => resolve(svg),
        (message) => reject(new Error(message || "PlantUML render failed")),
        dark ? { dark: true } : undefined,
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
): Promise<string> {
  const source = normalizePlantUmlSource(code.trim());
  const key = diagramCacheKey("plantuml", source, dark);
  return getOrRenderDiagramSvg(key, () =>
    renderPlantUmlUncached(source, dark),
  );
}

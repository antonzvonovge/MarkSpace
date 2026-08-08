import {
  diagramCacheKey,
  hydrateDiagramSvg,
  peekDiagramSvg,
  type DiagramEngine,
  type DiagramSkin,
} from "./diagramCache";
import { applyPlantUmlSkin } from "./plantuml/renderPlantUml";

const DEBOUNCE_MS = 300;

export type DiagramPreviewState = {
  svg: string | null;
  error: string | null;
  pending: boolean;
};

function formatDiagramError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.error === "string") return rec.error;
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}

function cacheSource(
  engine: DiagramEngine,
  code: string,
  skin: DiagramSkin,
  dark: boolean,
): string {
  const trimmed = code.trim();
  return engine === "plantuml"
    ? applyPlantUmlSkin(trimmed, skin, dark)
    : trimmed;
}

/**
 * Resolve diagram SVG with memory + disk cache.
 * - Memory hit: sync, no spinner
 * - Disk hit: async, no debounce (usually ms)
 * - Miss: debounce then render (persists to disk)
 */
export function scheduleDiagramPreview(options: {
  engine: DiagramEngine;
  code: string;
  dark: boolean;
  skin?: DiagramSkin;
  render: (
    code: string,
    dark: boolean,
    skin: DiagramSkin,
  ) => Promise<string>;
  onUpdate: (state: DiagramPreviewState) => void;
}): () => void {
  const skin = options.skin ?? "default";
  const source = cacheSource(
    options.engine,
    options.code,
    skin,
    options.dark,
  );
  if (!source) {
    options.onUpdate({ svg: null, error: null, pending: false });
    return () => {};
  }

  const key = diagramCacheKey(options.engine, source, options.dark, skin);
  const cached = peekDiagramSvg(key);
  if (cached !== undefined) {
    options.onUpdate({ svg: cached, error: null, pending: false });
    return () => {};
  }

  let cancelled = false;
  let debounceTimer: number | undefined;
  options.onUpdate({ svg: null, error: null, pending: true });

  void (async () => {
    const fromDisk = await hydrateDiagramSvg(key);
    if (cancelled) return;
    if (fromDisk !== undefined) {
      options.onUpdate({ svg: fromDisk, error: null, pending: false });
      return;
    }

    debounceTimer = window.setTimeout(() => {
      void options.render(source, options.dark, skin).then(
        (svg) => {
          if (cancelled) return;
          options.onUpdate({ svg, error: null, pending: false });
        },
        (err) => {
          if (cancelled) return;
          options.onUpdate({
            svg: null,
            error: formatDiagramError(err),
            pending: false,
          });
        },
      );
    }, DEBOUNCE_MS);
  })();

  return () => {
    cancelled = true;
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
  };
}

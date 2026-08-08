/** In-memory LRU + IndexedDB persistence + in-flight dedupe for diagram SVGs. */

import {
  diskGetDiagram,
  diskPutDiagram,
  diskTouchDiagram,
} from "./diagramCacheIdb";

export type DiagramEngine =
  | "mermaid"
  | "plantuml"
  | "d2"
  | "dot"
  | "markmap";

/** `neutral` = muted gray palette (chat); `default` = engine themes (editor). */
export type DiagramSkin = "default" | "neutral";

type CacheEntry = {
  svg: string;
};

const MAX_ENTRIES = 80;

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

/** Bump when neutral/chat render settings change so stale SVGs are not reused. */
const CACHE_REV = 10;

export function diagramCacheKey(
  engine: DiagramEngine,
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): string {
  return `${engine}:${dark ? "1" : "0"}:${skin}:r${CACHE_REV}:${code}`;
}

export function peekDiagramSvg(key: string): string | undefined {
  const entry = memory.get(key);
  if (!entry) return undefined;
  memory.delete(key);
  memory.set(key, entry);
  return entry.svg;
}

function remember(key: string, svg: string) {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, { svg });
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** Load from IndexedDB into memory (if present). */
export async function hydrateDiagramSvg(
  key: string,
): Promise<string | undefined> {
  const mem = peekDiagramSvg(key);
  if (mem !== undefined) return mem;

  const disk = await diskGetDiagram(key);
  if (!disk?.svg) return undefined;

  remember(key, disk.svg);
  void diskTouchDiagram(key);
  return disk.svg;
}

function persist(key: string, svg: string) {
  void diskPutDiagram(key, svg);
}

/**
 * Return cached SVG (memory → disk) or run `render`, sharing one in-flight
 * promise per key. Successful renders are written through to IndexedDB.
 */
export function getOrRenderDiagramSvg(
  key: string,
  render: () => Promise<string>,
): Promise<string> {
  const hit = peekDiagramSvg(key);
  if (hit !== undefined) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const fromDisk = await hydrateDiagramSvg(key);
    if (fromDisk !== undefined) return fromDisk;

    const svg = await render();
    remember(key, svg);
    persist(key, svg);
    return svg;
  })().then(
    (svg) => {
      inflight.delete(key);
      return svg;
    },
    (err) => {
      inflight.delete(key);
      throw err;
    },
  );

  inflight.set(key, task);
  return task;
}

import {
  diskGetDiagram,
  diskPutDiagram,
  diskTouchDiagram,
} from "../diagramCacheIdb";
import { hashXml } from "./constants";

type CacheEntry = { svg: string };

const MAX_ENTRIES = 80;
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

export function drawioPreviewCacheKey(path: string, xml: string): string {
  return `drawio:${path}:${hashXml(xml)}`;
}

export function peekDrawioSvg(key: string): string | undefined {
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

export async function hydrateDrawioSvg(
  key: string,
): Promise<string | undefined> {
  const mem = peekDrawioSvg(key);
  if (mem !== undefined) return mem;
  const disk = await diskGetDiagram(key);
  if (!disk?.svg) return undefined;
  remember(key, disk.svg);
  void diskTouchDiagram(key);
  return disk.svg;
}

export function putDrawioSvg(key: string, svg: string) {
  remember(key, svg);
  void diskPutDiagram(key, svg);
}

export function getOrRenderDrawioSvg(
  key: string,
  render: () => Promise<string>,
): Promise<string> {
  const hit = peekDrawioSvg(key);
  if (hit !== undefined) return Promise.resolve(hit);

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = (async () => {
    const fromDisk = await hydrateDrawioSvg(key);
    if (fromDisk !== undefined) return fromDisk;
    const svg = await render();
    putDrawioSvg(key, svg);
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

import { buildTagMap, searchShapes } from "./vendor/shape-search.js";

const SHAPE_INDEX_URL =
  "https://cdn.jsdelivr.net/gh/jgraph/drawio-mcp@main/shape-search/search-index.json";

type ShapeIndex = unknown[];

type ShapeSearchCache = {
  shapeIndex: ShapeIndex;
  tagMap: Record<string, Set<number>>;
};

let cache: ShapeSearchCache | null = null;
let inflight: Promise<ShapeSearchCache> | null = null;

async function loadIndex(): Promise<ShapeSearchCache> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const res = await fetch(SHAPE_INDEX_URL);
      if (!res.ok) {
        throw new Error(
          `Could not load the draw.io shape search index (HTTP ${res.status}).`,
        );
      }
      const shapeIndex = (await res.json()) as ShapeIndex;
      if (!Array.isArray(shapeIndex) || shapeIndex.length === 0) {
        throw new Error("Shape search index is empty or invalid");
      }
      const tagMap = buildTagMap(shapeIndex as Array<{ tags?: string }>);
      const next: ShapeSearchCache = { shapeIndex, tagMap };
      cache = next;
      return next;
    })().catch((err) => {
      inflight = null;
      throw err;
    });
  }
  return inflight;
}

export async function searchDrawioShapes(
  query: string,
  limit = 10,
): Promise<Array<{ style: string; w: number; h: number; title: string }>> {
  const q = query.trim();
  if (!q) throw new Error("query must be a non-empty string");
  const { shapeIndex, tagMap } = await loadIndex();
  return searchShapes(shapeIndex, tagMap, q, Math.min(Math.max(limit, 1), 50));
}

/** @internal */
export function _resetShapeSearchCacheForTests() {
  cache = null;
  inflight = null;
}

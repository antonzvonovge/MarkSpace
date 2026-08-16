export type DrawioShapeHit = {
  style: string;
  w: number;
  h: number;
  title: string;
};

export function buildTagMap(
  shapeIndex: Array<{ tags?: string }>,
): Record<string, Set<number>>;

export function searchShapes(
  shapeIndex: unknown[],
  tagMap: Record<string, Set<number>>,
  query: string,
  limit: number,
): DrawioShapeHit[];

export function searchShapesWithMeta(
  shapeIndex: unknown[],
  tagMap: Record<string, Set<number>>,
  query: string,
  limit: number,
): { results: DrawioShapeHit[]; strong: boolean };

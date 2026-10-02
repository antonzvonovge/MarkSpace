/** Pixel resize for the Live image transformer (edges and corners). */

export const MIN_IMAGE_EDGE = 32;
export const MAX_IMAGE_EDGE = 4096;

export type ImageResizeHandle =
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w"
  | "nw";

const WIDTH_HANDLES = new Set<ImageResizeHandle>([
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
]);

const HEIGHT_HANDLES = new Set<ImageResizeHandle>([
  "n",
  "s",
  "ne",
  "nw",
  "se",
  "sw",
]);

export function handleChangesWidth(handle: ImageResizeHandle): boolean {
  return WIDTH_HANDLES.has(handle);
}

export function handleChangesHeight(handle: ImageResizeHandle): boolean {
  return HEIGHT_HANDLES.has(handle);
}

export type ImageResizeOrigin = {
  handle: ImageResizeHandle;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  /** Centered images grow on both sides, matching BlockNote's width handles. */
  textAlignment?: string;
  maxWidth: number;
};

export type ImageResizeSize = {
  width: number;
  height: number;
};

function clampEdge(value: number, max: number): number {
  const cap = Math.max(1, max);
  return Math.round(Math.min(Math.max(value, MIN_IMAGE_EDGE), cap));
}

/**
 * Next box from a pointer position. Width and height move independently, so a
 * corner drag stretches the image instead of locking the aspect ratio.
 */
export function resizeImage(
  origin: ImageResizeOrigin,
  clientX: number,
  clientY: number,
): ImageResizeSize {
  let dx = clientX - origin.startX;
  let dy = clientY - origin.startY;
  if (
    origin.textAlignment === "center" &&
    handleChangesWidth(origin.handle)
  ) {
    dx *= 2;
  }

  let width = origin.startWidth;
  let height = origin.startHeight;
  const handle = origin.handle;
  if (handle === "e" || handle === "ne" || handle === "se") width += dx;
  if (handle === "w" || handle === "nw" || handle === "sw") width -= dx;
  if (handle === "s" || handle === "se" || handle === "sw") height += dy;
  if (handle === "n" || handle === "ne" || handle === "nw") height -= dy;

  return {
    width: handleChangesWidth(handle)
      ? clampEdge(width, origin.maxWidth)
      : Math.round(origin.startWidth),
    height: handleChangesHeight(handle)
      ? clampEdge(height, MAX_IMAGE_EDGE)
      : Math.round(origin.startHeight),
  };
}

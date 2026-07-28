/** Tracks a vault .drawio path while dragging from the file tree into the editor. */

export const DRAWIO_TREE_MIME = "application/x-markspace-drawio";

let activePath: string | null = null;
let clearTimer: number | null = null;

export function beginDrawioTreeDrag(path: string) {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  activePath = path.toLowerCase().endsWith(".drawio") ? path : null;
}

/** Prefer mime payload; fall back to the in-memory bridge. */
export function drawioPathFromDrop(dataTransfer: DataTransfer | null): string | null {
  const fromMime = dataTransfer?.getData(DRAWIO_TREE_MIME)?.trim();
  if (fromMime && fromMime.toLowerCase().endsWith(".drawio")) return fromMime;
  const fromBridge = getActiveDrawioTreeDrag();
  if (fromBridge) return fromBridge;
  const fromText = dataTransfer?.getData("text/plain")?.trim();
  if (fromText && fromText.toLowerCase().endsWith(".drawio")) return fromText;
  return null;
}

/** Clear after a tick so drop handlers can still read the path. */
export function endDrawioTreeDrag() {
  if (clearTimer != null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    activePath = null;
    clearTimer = null;
  }, 50);
}

export function clearDrawioTreeDrag() {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  activePath = null;
}

export function getActiveDrawioTreeDrag(): string | null {
  return activePath;
}

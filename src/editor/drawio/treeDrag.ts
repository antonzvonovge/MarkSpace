/** Tracks a vault .drawio path while dragging from the file tree into the editor. */

let activePath: string | null = null;
let clearTimer: number | null = null;

export function beginDrawioTreeDrag(path: string) {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  activePath = path.toLowerCase().endsWith(".drawio") ? path : null;
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

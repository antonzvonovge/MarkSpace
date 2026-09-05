/** Vault file path while dragging from the sidebar into chat (or other panes). */

export const VAULT_TREE_MIME = "application/x-markspace-vault-path";

/**
 * Pointer-based external drop (dnd-kit has no HTML5 dataTransfer).
 * Consumers listen on `window` and call `preventDefault` when they handle it.
 */
export const VAULT_TREE_POINTER_DROP_EVENT = "markspace-vault-tree-pointer-drop";

export type VaultTreePointerDropDetail = {
  path: string;
  clientX: number;
  clientY: number;
};

let activePath: string | null = null;
let clearTimer: number | null = null;
type DragListener = (path: string | null) => void;
const listeners = new Set<DragListener>();

function notify(path: string | null) {
  for (const listener of listeners) listener(path);
}

/** Folder chips use a trailing `/` (same as the old HTML5 dragstart payload). */
export function normalizeVaultTreeDragPath(
  path: string,
  isDir: boolean,
): string {
  if (!isDir) return path;
  return path.endsWith("/") ? path : `${path}/`;
}

export function beginVaultTreeDrag(path: string) {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (activePath === path) return;
  activePath = path;
  notify(activePath);
}

/** Prefer mime payload; fall back to the in-memory bridge. */
export function vaultPathFromDrop(
  dataTransfer: DataTransfer | null,
): string | null {
  const fromMime = dataTransfer?.getData(VAULT_TREE_MIME)?.trim();
  if (fromMime) return fromMime;
  const fromBridge = getActiveVaultTreeDrag();
  if (fromBridge) return fromBridge;
  return null;
}

export function isVaultTreeDrag(
  dataTransfer: DataTransfer | null | undefined,
): boolean {
  if (getActiveVaultTreeDrag()) return true;
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types as ArrayLike<string>);
  return types.includes(VAULT_TREE_MIME);
}

/** Clear after a tick so drop handlers can still read the path. */
export function endVaultTreeDrag() {
  if (clearTimer != null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    activePath = null;
    clearTimer = null;
    notify(null);
  }, 50);
}

export function clearVaultTreeDrag() {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (activePath == null) return;
  activePath = null;
  notify(null);
}

export function getActiveVaultTreeDrag(): string | null {
  return activePath;
}

/** Subscribe to the in-memory bridge (for drop-hint chrome without HTML5 drag). */
export function subscribeVaultTreeDrag(listener: DragListener): () => void {
  listeners.add(listener);
  listener(activePath);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Deliver a vault path to panes outside the sidebar DndContext (chat composer,
 * note editor). Returns true if a listener called preventDefault.
 */
export function dispatchVaultTreePointerDrop(
  path: string,
  clientX: number,
  clientY: number,
): boolean {
  const event = new CustomEvent<VaultTreePointerDropDetail>(
    VAULT_TREE_POINTER_DROP_EVENT,
    {
      detail: { path, clientX, clientY },
      cancelable: true,
    },
  );
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** True when `(clientX, clientY)` is over `root` (ignores pointer-events:none overlays). */
export function pointOverElement(
  root: Element | null | undefined,
  clientX: number,
  clientY: number,
): boolean {
  if (!root) return false;
  const under = document.elementFromPoint(clientX, clientY);
  return Boolean(under && root.contains(under));
}

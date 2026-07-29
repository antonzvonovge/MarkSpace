/** Vault file path while dragging from the sidebar into chat (or other panes). */

export const VAULT_TREE_MIME = "application/x-markspace-vault-path";

let activePath: string | null = null;
let clearTimer: number | null = null;

export function beginVaultTreeDrag(path: string) {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  activePath = path;
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
  }, 50);
}

export function clearVaultTreeDrag() {
  if (clearTimer != null) {
    window.clearTimeout(clearTimer);
    clearTimer = null;
  }
  activePath = null;
}

export function getActiveVaultTreeDrag(): string | null {
  return activePath;
}

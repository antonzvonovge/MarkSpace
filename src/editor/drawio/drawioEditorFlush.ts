/** Pending Draw.io→store flushes, keyed by diagram path (one editor per tab). */
const flushers = new Map<string, () => void>();

/** Register a sync flush for a Draw.io editor instance. */
export function registerDrawioEditorFlush(
  path: string,
  flush: () => void,
): () => void {
  flushers.set(path, flush);
  return () => {
    if (flushers.get(path) === flush) flushers.delete(path);
  };
}

/**
 * Push debounced XML into the vault store before save, tab stash, or close.
 * No-op when nothing is queued.
 */
export function flushDrawioEditor(path?: string | null): void {
  if (path) {
    flushers.get(path)?.();
    return;
  }
  for (const flush of flushers.values()) flush();
}

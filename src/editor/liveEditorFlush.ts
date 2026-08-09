/** Pending Live→markdown serializers, keyed by note path (one editor per tab). */
const flushers = new Map<string, () => void>();

/** Register a sync flush for a Live editor instance. */
export function registerLiveEditorFlush(
  path: string,
  flush: () => void,
): () => void {
  flushers.set(path, flush);
  return () => {
    if (flushers.get(path) === flush) flushers.delete(path);
  };
}

/**
 * Run pending Live serialization into the vault store before save, tab stash,
 * or Live→Source switch. No-op when nothing is queued.
 */
export function flushLiveEditor(path?: string | null): void {
  if (path) {
    flushers.get(path)?.();
    return;
  }
  for (const flush of flushers.values()) flush();
}

import { useEffect, useSyncExternalStore } from "react";
import {
  loadTaskIndex,
  reconcileTaskIndexCache,
  type TaskIndexEntry,
} from "../../lib/taskNotes";
import type { TreeNode } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";

type IndexSnap = {
  entries: readonly TaskIndexEntry[];
  loading: boolean;
  error: string | null;
  /** Bumped by a full re-read so a later path-only reconcile cannot overwrite it. */
  revision: number;
};

let snap: IndexSnap = {
  entries: [],
  loading: true,
  error: null,
  revision: 0,
};
let seenTree: TreeNode | null | undefined;
let started = false;
let epoch = 0;
const listeners = new Set<() => void>();

function publish(next: IndexSnap) {
  snap = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function load(tree: TreeNode | null | undefined, force: boolean) {
  const token = ++epoch;
  const prev = snap.entries;
  const baseRevision = snap.revision;
  try {
    const entries = force
      ? await loadTaskIndex(tree, prev.length > 0 ? prev : undefined)
      : await reconcileTaskIndexCache(tree, prev);
    if (token !== epoch) return;
    if (!force && entries === prev) {
      if (snap.loading || snap.error) {
        publish({ entries: prev, loading: false, error: null, revision: snap.revision });
      }
      return;
    }
    if (!force && snap.revision !== baseRevision) return;
    publish({
      entries,
      loading: false,
      error: null,
      revision: force ? snap.revision + 1 : snap.revision,
    });
  } catch (err) {
    if (token !== epoch) return;
    publish({
      entries: prev,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
      revision: snap.revision,
    });
  }
}

function ensure(tree: TreeNode | null | undefined) {
  if (started && tree === seenTree) return;
  started = true;
  seenTree = tree;
  void load(tree, false);
}

/** Re-read open task notes after an edit that kept the same paths. */
export function reloadTaskIndex(): Promise<void> {
  const tree = useVaultStore.getState().tree;
  seenTree = tree;
  return load(tree, true);
}

export function useTaskIndex(live: boolean): IndexSnap {
  const tree = useVaultStore((s) => s.tree);
  const current = useSyncExternalStore(subscribe, () => snap, () => snap);
  useEffect(() => {
    if (!live) return;
    ensure(tree);
  }, [tree, live]);
  return current;
}

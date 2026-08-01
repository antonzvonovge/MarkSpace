import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listNoteTags, type NoteTags, type TreeNode } from "../../lib/vaultApi";
import {
  buildTagGraph,
  type BuildTagGraphOptions,
  type TagGraphData,
} from "../../lib/tagGraph";
import { GRAPH_TAB_PATH, useVaultStore } from "../../store/vaultStore";

export type TagGraphViewOptions = {
  showUntagged: boolean;
  tagsOnly: boolean;
  /** First-level vault project path; null includes the entire vault. */
  projectPath: string | null;
  /** Focus node id (`tag:…` / `note:…`) for local subgraph; null = full vault. */
  focusRoot: string | null;
};

function collectMarkdownPaths(node: TreeNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (!node.isDir && node.path.toLowerCase().endsWith(".md")) {
    out.push(node.path);
  }
  for (const child of node.children ?? []) collectMarkdownPaths(child, out);
  return out;
}

export function useTagGraph(options: TagGraphViewOptions) {
  const vaultTags = useVaultStore((s) => s.vaultTags);
  const tree = useVaultStore((s) => s.tree);
  const activePath = useVaultStore((s) => s.activePath);
  const isActive = activePath === GRAPH_TAB_PATH;

  const [noteTags, setNoteTags] = useState<NoteTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await listNoteTags();
      if (id !== requestId.current) return;
      setNoteTags(next);
      setError(null);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  // Fetch when the graph tab becomes active.
  useEffect(() => {
    if (!isActive) return;
    setLoading(true);
    void refresh();
  }, [isActive, refresh]);

  // Re-fetch when the tag catalog changes (watcher / save), debounced.
  useEffect(() => {
    if (!isActive) return;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void refresh();
    }, 350);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [vaultTags, isActive, refresh]);

  const allNotePaths = useMemo(() => collectMarkdownPaths(tree), [tree]);
  const inSelectedProject = useCallback(
    (path: string) =>
      !options.projectPath || path.startsWith(`${options.projectPath}/`),
    [options.projectPath],
  );
  const scopedNoteTags = useMemo(
    () => noteTags.filter((entry) => inSelectedProject(entry.path)),
    [noteTags, inSelectedProject],
  );
  const scopedNotePaths = useMemo(
    () => allNotePaths.filter(inSelectedProject),
    [allNotePaths, inSelectedProject],
  );

  const data: TagGraphData = useMemo(() => {
    const opts: BuildTagGraphOptions = {
      showUntagged: options.showUntagged,
      tagsOnly: options.tagsOnly,
      allNotePaths: scopedNotePaths,
      root: options.focusRoot,
      depth: options.focusRoot ? 1 : undefined,
    };
    return buildTagGraph(scopedNoteTags, opts);
  }, [
    scopedNoteTags,
    scopedNotePaths,
    options.showUntagged,
    options.tagsOnly,
    options.focusRoot,
  ]);

  return {
    data,
    loading,
    error,
    refresh,
    isActive,
    noteCount: scopedNoteTags.length,
    tagCount: vaultTags.length,
  };
}

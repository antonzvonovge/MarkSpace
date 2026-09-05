import { useEffect, useMemo, useRef, useState } from "react";
import { flushLiveEditor } from "../editor/liveEditorFlush";
import { documentKind } from "../lib/vaultApi";
import { isFileTab, type EditorTab } from "../store/vaultStore";

/** How many Live markdown editors stay mounted (including the active one). */
export const WARM_LIVE_MARKDOWN_LIMIT = 4;

function openMarkdownPaths(tabs: Pick<EditorTab, "path" | "kind">[]): string[] {
  const out: string[] = [];
  for (const tab of tabs) {
    if (!isFileTab(tab)) continue;
    if (documentKind(tab.path) !== "markdown") continue;
    out.push(tab.path);
  }
  return out;
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * MRU keep-alive set for BlockNote Live editors. Active markdown is always
 * first; colder open notes drop out and remount from `tab.body` on return.
 */
export function useWarmLiveMarkdownPaths(
  tabs: Pick<EditorTab, "path" | "kind">[],
  activePath: string | null,
): Set<string> {
  // Ignore body/dirty churn — only open markdown paths matter for LRU.
  const openKey = openMarkdownPaths(tabs).join("\0");
  const [warm, setWarm] = useState<string[]>([]);
  const prevWarmRef = useRef<string[]>([]);

  useEffect(() => {
    const open = new Set(openKey ? openKey.split("\0") : []);
    setWarm((prev) => {
      let next = prev.filter((p) => open.has(p));
      if (activePath && open.has(activePath)) {
        next = [activePath, ...next.filter((p) => p !== activePath)];
      }
      return sameOrder(prev, next) ? prev : next;
    });
    // Evicting a cold editor tears down its ProseMirror view; do it after the
    // switch has painted instead of inside the activation commit.
    const trim = window.setTimeout(() => {
      setWarm((prev) =>
        prev.length <= WARM_LIVE_MARKDOWN_LIMIT
          ? prev
          : prev.slice(0, WARM_LIVE_MARKDOWN_LIMIT),
      );
    }, 250);
    return () => window.clearTimeout(trim);
  }, [openKey, activePath]);

  useEffect(() => {
    const prev = prevWarmRef.current;
    const nextSet = new Set(warm);
    for (const path of prev) {
      if (!nextSet.has(path)) flushLiveEditor(path);
    }
    prevWarmRef.current = warm;
  }, [warm]);

  return useMemo(() => new Set(warm), [warm]);
}

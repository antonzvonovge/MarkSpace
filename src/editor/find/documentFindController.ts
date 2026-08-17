import {
  collectFindRanges,
  findExactMatches,
  pickFindIndex,
  type TextRange,
} from "../../lib/documentFind";
import { documentKind } from "../../lib/vaultApi";
import { useDocumentFindStore } from "../../store/documentFindStore";
import { isFileTab, useVaultStore } from "../../store/vaultStore";
import {
  forEachLiveEditor,
  forEachSourceEditor,
  getActiveMarkdownSelection,
  getLiveEditor,
  getSourceEditor,
} from "../completedTasksCommand";
import {
  getFindPluginState,
  scrollToCurrentFindMatch,
  setFindDecorationsMeta,
} from "./findDecorations";
import { applySourceFind, clearSourceFind } from "./sourceFind";

export function isActiveMarkdownFile(): boolean {
  const { activePath, tabs } = useVaultStore.getState();
  if (!activePath) return false;
  const tab = tabs.find((t) => t.path === activePath);
  if (!tab || !isFileTab(tab)) return false;
  return documentKind(activePath) === "markdown";
}

function liveView(path: string) {
  return getLiveEditor(path)?._tiptapEditor?.view ?? null;
}

function clearAllFindDecorations(): void {
  forEachLiveEditor((_path, editor) => {
    const view = editor._tiptapEditor?.view;
    if (!view) return;
    const st = getFindPluginState(view);
    if (!st || (!st.query && st.ranges.length === 0)) return;
    setFindDecorationsMeta(view, { clear: true });
  });
  forEachSourceEditor((_path, view) => {
    clearSourceFind(view);
  });
}

function refreshDocumentFind(opts: {
  preferCaret: boolean;
  scroll: boolean;
}): void {
  const find = useDocumentFindStore.getState();
  if (!find.open || !isActiveMarkdownFile()) {
    clearAllFindDecorations();
    if (find.open) find.closeFind();
    else find.setMatchState(0, -1);
    return;
  }

  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath) return;

  if (viewMode === "source") {
    forEachLiveEditor((_path, editor) => {
      const view = editor._tiptapEditor?.view;
      if (!view) return;
      const st = getFindPluginState(view);
      if (!st || (!st.query && st.ranges.length === 0)) return;
      setFindDecorationsMeta(view, { clear: true });
    });
    const view = getSourceEditor(activePath);
    if (!view) {
      find.setMatchState(0, -1);
      return;
    }
    const ranges = findExactMatches(
      view.state.doc.toString(),
      find.query,
      find.matchCase,
    );
    const index = pickFindIndex(
      ranges,
      view.state.selection.main.from,
      find.activeIndex,
      opts.preferCaret,
    );
    find.setMatchState(ranges.length, index);
    applySourceFind(view, { ranges, activeIndex: index }, opts.scroll);
    return;
  }

  forEachSourceEditor((_path, view) => {
    clearSourceFind(view);
  });

  let applied = false;
  forEachLiveEditor((path, editor) => {
    const view = editor._tiptapEditor?.view;
    if (!view) return;
    if (path !== activePath) {
      const st = getFindPluginState(view);
      if (!st || (!st.query && st.ranges.length === 0)) return;
      setFindDecorationsMeta(view, { clear: true });
      return;
    }
    applied = true;
    const ranges = collectFindRanges(
      view.state.doc,
      find.query,
      find.matchCase,
    );
    const index = pickFindIndex(
      ranges,
      view.state.selection.from,
      find.activeIndex,
      opts.preferCaret,
    );
    find.setMatchState(ranges.length, index);
    const prev = getFindPluginState(view);
    const same =
      prev &&
      prev.query === find.query &&
      prev.matchCase === find.matchCase &&
      prev.activeIndex === index &&
      sameRanges(prev.ranges, ranges);
    if (!same) {
      setFindDecorationsMeta(view, {
        query: find.query,
        matchCase: find.matchCase,
        activeIndex: index,
      });
    }
    if (opts.scroll) scrollToCurrentFindMatch(view);
  });
  if (!applied) find.setMatchState(0, -1);
}

function revealActiveFindMatch(): void {
  const find = useDocumentFindStore.getState();
  if (!find.open || !isActiveMarkdownFile()) return;
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath) return;

  if (viewMode === "source") {
    const view = getSourceEditor(activePath);
    if (!view) return;
    const ranges = findExactMatches(
      view.state.doc.toString(),
      find.query,
      find.matchCase,
    );
    applySourceFind(
      view,
      { ranges, activeIndex: find.activeIndex },
      true,
    );
    return;
  }

  const view = liveView(activePath);
  if (!view) return;
  setFindDecorationsMeta(view, { activeIndex: find.activeIndex });
  scrollToCurrentFindMatch(view);
}

export function refreshDocumentFindIfOpen(): void {
  if (!useDocumentFindStore.getState().open) return;
  refreshDocumentFind({ preferCaret: false, scroll: false });
}

export function openDocumentFind(): boolean {
  if (!isActiveMarkdownFile()) return false;
  const selected = getActiveMarkdownSelection();
  const query =
    selected.length > 2000 ? selected.slice(0, 2000) : selected;
  useDocumentFindStore.getState().openFind(query || undefined);
  return true;
}

export function closeDocumentFind(): void {
  useDocumentFindStore.getState().closeFind();
}

export function stepDocumentFind(direction: 1 | -1): void {
  if (!isActiveMarkdownFile()) return;
  const st = useDocumentFindStore.getState();
  if (!st.open) {
    if (st.query) st.openFind();
    else openDocumentFind();
    return;
  }
  if (st.matchCount <= 0) return;
  const next =
    direction === 1
      ? (st.activeIndex + 1) % st.matchCount
      : (st.activeIndex - 1 + st.matchCount) % st.matchCount;
  st.setActiveIndex(next);
}

export function subscribeDocumentFind(): () => void {
  const unsubFind = useDocumentFindStore.subscribe((st, prev) => {
    const opened = st.open && !prev.open;
    const closed = !st.open && prev.open;
    const queryChanged = st.query !== prev.query;
    const caseChanged = st.matchCase !== prev.matchCase;
    if (closed) {
      refreshDocumentFind({ preferCaret: false, scroll: false });
      return;
    }
    if (opened || queryChanged || caseChanged) {
      refreshDocumentFind({
        preferCaret: true,
        scroll: Boolean(st.query),
      });
      return;
    }
    if (st.open && st.activeIndex !== prev.activeIndex) {
      revealActiveFindMatch();
    }
  });

  const unsubVault = useVaultStore.subscribe((st, prev) => {
    if (
      st.activePath === prev.activePath &&
      st.viewMode === prev.viewMode
    ) {
      return;
    }
    if (!useDocumentFindStore.getState().open) return;
    if (!isActiveMarkdownFile()) {
      useDocumentFindStore.getState().closeFind();
      return;
    }
    refreshDocumentFind({ preferCaret: true, scroll: true });
  });

  return () => {
    unsubFind();
    unsubVault();
  };
}

function sameRanges(a: TextRange[], b: TextRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.from !== b[i]!.from || a[i]!.to !== b[i]!.to) return false;
  }
  return true;
}

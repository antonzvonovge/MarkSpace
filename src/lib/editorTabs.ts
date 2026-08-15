import { arrayMove } from "./arrayMove";

/** Minimal tab shape for pin grouping / reorder. */
export type PinnableTab = {
  path: string;
  pinned?: boolean;
  preview?: boolean;
};

export function isTabPinned(tab: PinnableTab): boolean {
  return Boolean(tab.pinned);
}

/** Index of the last pinned tab, or `-1` if none. */
export function lastPinnedIndex(tabs: readonly PinnableTab[]): number {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (tabs[i]?.pinned) return i;
  }
  return -1;
}

/**
 * Keep pinned tabs as a left-hand prefix, preserving relative order
 * within each group. Returns the same array when already grouped.
 */
export function groupPinnedTabs<T extends PinnableTab>(tabs: T[]): T[] {
  let seenUnpinned = false;
  for (const tab of tabs) {
    if (tab.pinned) {
      if (seenUnpinned) {
        const pinned: T[] = [];
        const rest: T[] = [];
        for (const t of tabs) {
          if (t.pinned) pinned.push(t);
          else rest.push(t);
        }
        return [...pinned, ...rest];
      }
    } else {
      seenUnpinned = true;
    }
  }
  return tabs;
}

/**
 * Pin or unpin a tab (Cursor/VS Code). Pinning clears preview and moves the
 * tab to the end of the pinned prefix; unpinning moves it to the start of
 * the unpinned group.
 */
export function setTabPinned<T extends PinnableTab>(
  tabs: T[],
  path: string,
  pinned: boolean,
): T[] {
  const idx = tabs.findIndex((t) => t.path === path);
  if (idx < 0) return tabs;
  const tab = tabs[idx]!;
  const wasPinned = Boolean(tab.pinned);
  if (wasPinned === pinned && !(pinned && tab.preview)) return tabs;

  const next = tabs.slice();
  next.splice(idx, 1);
  const updated: T = {
    ...tab,
    pinned,
    preview: pinned ? false : tab.preview,
  };
  const insertAt = next.reduce((n, t) => n + (t.pinned ? 1 : 0), 0);
  next.splice(insertAt, 0, updated);
  return next;
}

/**
 * Reorder tabs. Crossing the pinned/unpinned boundary pins or unpins the
 * dragged tab. Reordering when nothing is pinned never pins by itself.
 */
export function reorderEditorTabs<T extends PinnableTab>(
  tabs: T[],
  from: number,
  to: number,
): T[] {
  const moved = arrayMove(tabs, from, to);
  if (moved === tabs) return tabs;
  const fromPinned = Boolean(tabs[from]?.pinned);
  let otherPinnedCount = 0;
  for (let i = 0; i < tabs.length; i++) {
    if (i !== from && tabs[i]?.pinned) otherPinnedCount += 1;
  }
  const shouldPin =
    to < otherPinnedCount || (fromPinned && to === otherPinnedCount);
  const item = moved[to]!;
  if (Boolean(item.pinned) === shouldPin && !(shouldPin && item.preview)) {
    return moved;
  }
  const next = moved.slice();
  next[to] = {
    ...item,
    pinned: shouldPin,
    preview: shouldPin ? false : item.preview,
  };
  return next;
}

/** Keep the current tab and every pinned tab (Close Others / Close Remaining). */
export function keepForCloseOthers<T extends PinnableTab>(
  tabs: readonly T[],
  currentPath: string,
): Set<string> {
  const keep = new Set<string>();
  for (const tab of tabs) {
    if (tab.pinned || tab.path === currentPath) keep.add(tab.path);
  }
  return keep;
}

/**
 * Keep the current tab, everything to its left, and every pinned tab
 * (even if a pin sits to the right).
 */
export function keepForCloseToTheRight<T extends PinnableTab>(
  tabs: readonly T[],
  currentPath: string,
): Set<string> {
  const index = tabs.findIndex((t) => t.path === currentPath);
  const keep = new Set<string>();
  if (index < 0) {
    for (const tab of tabs) keep.add(tab.path);
    return keep;
  }
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i]!;
    if (i <= index || tab.pinned) keep.add(tab.path);
  }
  return keep;
}

export function hasCloseableOthers<T extends PinnableTab>(
  tabs: readonly T[],
  currentPath: string,
): boolean {
  return tabs.some((t) => t.path !== currentPath && !t.pinned);
}

export function hasCloseableToTheRight<T extends PinnableTab>(
  tabs: readonly T[],
  currentPath: string,
): boolean {
  const index = tabs.findIndex((t) => t.path === currentPath);
  if (index < 0) return false;
  return tabs.some((t, i) => i > index && !t.pinned);
}

export type RectLike = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

let cachedSelectionRect: RectLike | null = null;

export function getLiveSelectionRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  return selection.getRangeAt(0);
}

export function getPageSelectionText(): string {
  const range = getLiveSelectionRange();
  if (!range) return "";
  return range.toString().trim();
}

/** Capture rect on context menu — selection is often cleared before OPEN_CHAT runs. */
export function cacheSelectionRectOnContextMenu(): void {
  document.addEventListener(
    "contextmenu",
    () => {
      const range = getLiveSelectionRange();
      if (!range) {
        cachedSelectionRect = null;
        return;
      }
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) {
        const rects = range.getClientRects();
        const last = rects[rects.length - 1];
        if (!last) {
          cachedSelectionRect = null;
          return;
        }
        cachedSelectionRect = {
          top: last.top,
          left: last.left,
          bottom: last.bottom,
          right: last.right,
        };
        return;
      }
      cachedSelectionRect = {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      };
    },
    true,
  );
}

function rectFromRange(range: Range): RectLike | null {
  const rect = range.getBoundingClientRect();
  if (rect.width > 0 || rect.height > 0) {
    return {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
    };
  }
  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (!last) return null;
  return {
    top: last.top,
    left: last.left,
    bottom: last.bottom,
    right: last.right,
  };
}

function resolveAnchorRect(): RectLike | null {
  const live = getLiveSelectionRange();
  if (live) {
    const rect = rectFromRange(live);
    if (rect) return rect;
  }
  return cachedSelectionRect;
}

export function clampPanelPosition(
  anchorRect: RectLike,
  panelWidth: number,
  panelHeight: number,
): { top: number; left: number } {
  const margin = 12;
  const gap = 8;
  const maxWidth = Math.min(panelWidth, window.innerWidth - margin * 2);
  const maxHeight = Math.min(panelHeight, window.innerHeight - margin * 2);

  let top = anchorRect.bottom + gap;
  let left = anchorRect.left;

  if (top + maxHeight > window.innerHeight - margin) {
    const above = anchorRect.top - gap - maxHeight;
    if (above >= margin) {
      top = above;
    } else {
      top = Math.max(margin, window.innerHeight - maxHeight - margin);
    }
  }

  if (left + maxWidth > window.innerWidth - margin) {
    left = window.innerWidth - maxWidth - margin;
  }
  if (left < margin) left = margin;

  return { top, left };
}

export function initialPanelPosition(
  panelWidth: number,
  panelHeight: number,
): { top: number; left: number } {
  const anchor = resolveAnchorRect();
  if (anchor) {
    return clampPanelPosition(anchor, panelWidth, panelHeight);
  }

  // No anchor — center of viewport, not bottom corner.
  const maxHeight = Math.min(panelHeight, window.innerHeight - 24);
  const maxWidth = Math.min(panelWidth, window.innerWidth - 24);
  return {
    top: Math.max(12, (window.innerHeight - maxHeight) / 2),
    left: Math.max(12, (window.innerWidth - maxWidth) / 2),
  };
}

export function clearCachedSelectionRect(): void {
  cachedSelectionRect = null;
}

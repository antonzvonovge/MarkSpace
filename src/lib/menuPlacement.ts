/**
 * Shared up/down placement for comboboxes and button dropdown menus.
 * Prefer `placeAnchoredMenu` over hard-coding above/below.
 */

export type MenuSide = "above" | "below";

export type PlaceMenuOpts = {
  gap?: number;
  /** Cap for returned maxHeight. Default 280. */
  maxHeight?: number;
  /** Min usable height to treat a side as “enough”. Default 120. */
  minHeight?: number;
  /**
   * Preferred side when both have room. Default `"below"`.
   * Use `"above"` for bottom-docked UI (e.g. chat composer at bottom).
   */
  prefer?: MenuSide;
  /** Force a side (skip auto). Prefer leaving unset. */
  force?: MenuSide;
  /** Menu width in px (clamped into the viewport). */
  width: number;
  /** Horizontal align against the anchor. Default `"start"`. */
  align?: "start" | "end";
};

export type PlacedMenu = {
  side: MenuSide;
  left: number;
  top: number | null;
  bottom: number | null;
  width: number;
  maxHeight: number;
};

/**
 * Decide above vs below from viewport space around `anchor`, then return
 * fixed-position coordinates suitable for a portaled menu.
 */
export function placeAnchoredMenu(
  anchor: DOMRect,
  opts: PlaceMenuOpts,
): PlacedMenu {
  const gap = opts.gap ?? 6;
  const maxHeightCap = opts.maxHeight ?? 280;
  const minHeight = opts.minHeight ?? 120;
  const prefer = opts.prefer ?? "below";
  const spaceAbove = anchor.top - gap;
  const spaceBelow = window.innerHeight - anchor.bottom - gap;

  let above: boolean;
  if (opts.force === "above") {
    above = true;
  } else if (opts.force === "below") {
    above = false;
  } else if (prefer === "above") {
    // Prefer above unless it does not fit and below has more room.
    above = spaceAbove >= minHeight || spaceAbove >= spaceBelow;
  } else {
    // Prefer below unless it does not fit and above has more room.
    above = spaceBelow < minHeight && spaceAbove > spaceBelow;
  }

  const width = opts.width;
  let left = opts.align === "end" ? anchor.right - width : anchor.left;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  const available = (above ? spaceAbove : spaceBelow) - 8;
  const maxHeight = Math.max(
    minHeight,
    Math.min(maxHeightCap, Math.max(0, available)),
  );

  return {
    side: above ? "above" : "below",
    left,
    top: above ? null : anchor.bottom + gap,
    bottom: above ? window.innerHeight - anchor.top + gap : null,
    width,
    maxHeight,
  };
}

export type ViewportSize = { width: number; height: number };

const POINTER_MENU_MARGIN = 8;

/**
 * Keep a pointer-opened menu on screen. Top-left sits on the cursor unless
 * that box would leave the viewport, in which case it flips to the other
 * side of the cursor and then clamps.
 */
export function placePointerMenu(
  x: number,
  y: number,
  size: { width: number; height: number },
  viewport: ViewportSize,
  margin = POINTER_MENU_MARGIN,
): { left: number; top: number } {
  const maxLeft = viewport.width - size.width - margin;
  const maxTop = viewport.height - size.height - margin;
  let left = x;
  if (left > maxLeft) left = x - size.width;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  let top = y;
  if (top > maxTop) top = y - size.height;
  if (top > maxTop) top = maxTop;
  if (top < margin) top = margin;

  return { left, top };
}

/** Flyout beside an already-open menu row, flipped when it would clip. */
export function placeFlyoutMenu(
  anchor: { top: number; left: number; right: number },
  size: { width: number; height: number },
  viewport: ViewportSize,
  margin = POINTER_MENU_MARGIN,
): { left: number; top: number } {
  let left = anchor.right - 2;
  if (left + size.width > viewport.width - margin) {
    left = anchor.left - size.width + 2;
  }
  if (left < margin) left = margin;
  if (left + size.width > viewport.width - margin) {
    left = Math.max(margin, viewport.width - size.width - margin);
  }

  let top = anchor.top;
  if (top + size.height > viewport.height - margin) {
    top = viewport.height - size.height - margin;
  }
  if (top < margin) top = margin;

  return { left, top };
}

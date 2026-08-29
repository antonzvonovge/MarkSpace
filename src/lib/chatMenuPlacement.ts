import {
  placeAnchoredMenu,
  type PlaceMenuOpts,
  type PlacedMenu,
} from "./menuPlacement";

/**
 * Empty chat docks the composer under the tab bar (`is-composer-top`).
 * In that layout menus should open downward; with the usual bottom composer
 * they prefer opening upward into the message list (still auto-flip if needed).
 */
export function chatComposerAtTop(from?: Element | null): boolean {
  if (from) return Boolean(from.closest(".chat-panel.is-composer-top"));
  return Boolean(document.querySelector(".chat-panel.is-composer-top"));
}

/** Placement for menus anchored to the chat composer (mode / model / project / slash). */
export function placeChatComposerMenu(
  anchor: DOMRect,
  opts: Omit<PlaceMenuOpts, "prefer" | "force"> & { from?: Element | null },
): PlacedMenu {
  const { from, ...rest } = opts;
  const atTop = chatComposerAtTop(from);
  return placeAnchoredMenu(anchor, {
    ...rest,
    force: atTop ? "below" : undefined,
    prefer: atTop ? "below" : "above",
  });
}

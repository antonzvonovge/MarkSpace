/**
 * Empty chat docks the composer under the tab bar (`is-composer-top`).
 * In that layout menus should open downward; with the usual bottom composer
 * they open upward into the message list.
 */
export function chatComposerAtTop(from?: Element | null): boolean {
  if (from) return Boolean(from.closest(".chat-panel.is-composer-top"));
  return Boolean(document.querySelector(".chat-panel.is-composer-top"));
}

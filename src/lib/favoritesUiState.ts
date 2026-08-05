/** Sidebar Favorites section UI (collapsed state). */

const COLLAPSED_KEY = "markspace-favorites-section-collapsed-v1";

export function loadFavoritesSectionCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveFavoritesSectionCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

const RESERVED_SECTION =
  ".incoming-section, .favorites-section, .tasks-section, .routines-section, .dashboards-section, .comments-inbox-section";

/**
 * Parent folder for a right-click on empty sidebar chrome.
 * Blank space in the file list is the vault root. Clicks inside Incoming,
 * Favorites, Tasks, and the other reserved sections keep the current folder.
 */
export function emptySidebarCreateParent(
  target: Element,
  selectedFolderPath: string,
): string {
  if (target.closest(RESERVED_SECTION)) return selectedFolderPath;
  if (target.closest(".tree-scroll, .workspace-section")) return "";
  return selectedFolderPath;
}

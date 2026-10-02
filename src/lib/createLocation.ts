import { diaryProjectRootForPath } from "./diaryNotes";
import { folderExistsInTree } from "./lastVaultFolder";
import {
  INCOMING_FOLDER,
  isRoutinesPath,
  isTasksPath,
  type ProjectProperties,
  type TreeNode,
} from "./vaultApi";

const STORAGE_KEY = "markspace.create.lastFolder";

export function getLastCreateFolder(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setLastCreateFolder(path: string): void {
  const rel = path.replace(/^\/+|\/+$/g, "");
  try {
    if (!rel) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, rel);
  } catch {
    /* ignore quota */
  }
}

/** Tasks, Routines, and diary projects are not create destinations. */
export function isCreateFolderAllowed(
  path: string,
  projectPropertiesByPath: Record<string, ProjectProperties>,
): boolean {
  const rel = path.replace(/^\/+|\/+$/g, "");
  if (!rel) return false;
  if (isTasksPath(rel) || isRoutinesPath(rel)) return false;
  if (diaryProjectRootForPath(rel, projectPropertiesByPath)) return false;
  return true;
}

/** Last allowed folder that still exists, otherwise Incoming. */
export function resolveCreateFolder(
  tree: TreeNode | null | undefined,
  projectPropertiesByPath: Record<string, ProjectProperties> = {},
): string {
  const last = getLastCreateFolder();
  if (
    last &&
    folderExistsInTree(tree, last) &&
    isCreateFolderAllowed(last, projectPropertiesByPath)
  ) {
    return last;
  }
  return INCOMING_FOLDER;
}

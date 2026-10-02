import type { TreeNode } from "../../lib/vaultApi";
import {
  isIncomingFolder,
  isIncomingPath,
  isDashboardsFolder,
  isDashboardsPath,
  isRoutinesFolder,
  isRoutinesPath,
  isSkillsFolder,
  isTasksFolder,
  isTasksPath,
  parentPath,
} from "../../lib/vaultApi";

export const VAULT_PATH = "";

export type FlattenedVaultRow = {
  path: string;
  name: string;
  isDir: boolean;
  hasChildren: boolean;
  /** 0 = vault root row. */
  depth: number;
  parentPath: string;
  indexAmongSiblings: number;
  /** Accepts drops as nest-into (folder) or nest-onto (.md note). */
  droppable: boolean;
};

function isMdNestTarget(path: string, isDir: boolean): boolean {
  if (isDir) return false;
  if (!path.toLowerCase().endsWith(".md")) return false;
  return !isSkillsFolder(parentPath(path), true);
}

/** Reserved roots have their own sidebar sections and are skipped here. */
function isWorkspaceChild(node: TreeNode): boolean {
  return (
    !isIncomingFolder(node.path, node.isDir) &&
    !isTasksFolder(node.path, node.isDir) &&
    !isRoutinesFolder(node.path, node.isDir) &&
    !isDashboardsFolder(node.path, node.isDir)
  );
}

/**
 * Visible workspace rows only (Incoming / Tasks / Routines omitted).
 * Vault root (`path === ""`) is always expanded.
 */
export function flattenVisibleWorkspace(
  root: TreeNode,
  expandedPaths: readonly string[],
): FlattenedVaultRow[] {
  const expanded = new Set(expandedPaths);
  const out: FlattenedVaultRow[] = [];

  const walk = (
    node: TreeNode,
    depth: number,
    parent: string,
    siblingIndex: number,
  ) => {
    const children = node.children ?? [];
    out.push({
      path: node.path,
      name: node.name,
      isDir: node.isDir,
      hasChildren: node.isDir && children.some(isWorkspaceChild),
      depth,
      parentPath: parent,
      indexAmongSiblings: siblingIndex,
      droppable: node.isDir || isMdNestTarget(node.path, node.isDir),
    });

    const isOpen = node.path === VAULT_PATH || expanded.has(node.path);
    if (!node.isDir || !isOpen) return;

    // Index within the full child list: drops send it to the vault as a slot in
    // the parent's on-disk order, which still holds the skipped folders.
    children.forEach((child, i) => {
      if (!isWorkspaceChild(child)) return;
      walk(child, depth + 1, node.path, i);
    });
  };

  walk(root, 0, "__tree_root__", 0);
  return out;
}

/** All workspace nodes (ignores expand) — for tests / Skills checks. */
export function flattenAllWorkspace(root: TreeNode): FlattenedVaultRow[] {
  const out: FlattenedVaultRow[] = [];
  const walk = (
    node: TreeNode,
    depth: number,
    parent: string,
    siblingIndex: number,
  ) => {
    const children = node.children ?? [];
    out.push({
      path: node.path,
      name: node.name,
      isDir: node.isDir,
      hasChildren: node.isDir && children.some(isWorkspaceChild),
      depth,
      parentPath: parent,
      indexAmongSiblings: siblingIndex,
      droppable: node.isDir || isMdNestTarget(node.path, node.isDir),
    });
    if (!node.isDir) return;
    children.forEach((child, i) => {
      if (!isWorkspaceChild(child)) return;
      walk(child, depth + 1, node.path, i);
    });
  };
  walk(root, 0, "__tree_root__", 0);
  return out;
}

/**
 * Drag between the Incoming section and the workspace tree (both directions).
 * `destParent` is the folder that receives the item: the hovered folder, or the
 * parent of a hovered file. Same-parent drops are rejected as no-ops.
 */
export function canMoveBetweenIncomingAndWorkspace(
  from: string,
  destParent: string,
): boolean {
  if (!from) return false;
  // Only this pair of sections; Tasks / Routines / Dashboards keep their own UI.
  if (!isIncomingPath(from) && !isIncomingPath(destParent)) return false;
  if (
    isTasksPath(destParent) ||
    isRoutinesPath(destParent) ||
    isDashboardsPath(destParent)
  ) {
    return false;
  }
  if (parentPath(from) === destParent) return false;
  return canDropVaultPath(from, destParent, true);
}

export function canDropVaultPath(
  from: string,
  targetPath: string,
  targetIsDir: boolean,
): boolean {
  if (!from) return false;
  if (from === targetPath) return false;
  if (targetPath.startsWith(`${from}/`)) return false;
  if (isIncomingFolder(from) || isTasksFolder(from) || isRoutinesFolder(from) || isDashboardsFolder(from)) return false;
  // Skills stays at vault root: only drop onto vault root.
  if (isSkillsFolder(from) && targetPath !== VAULT_PATH) return false;
  if (targetPath === VAULT_PATH) return true;
  if (targetIsDir) return true;
  if (isMdNestTarget(targetPath, false)) return true;
  return false;
}

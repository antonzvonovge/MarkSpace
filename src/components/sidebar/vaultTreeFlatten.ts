import type { TreeNode } from "../../lib/vaultApi";
import {
  isIncomingFolder,
  isSkillsFolder,
  isTasksFolder,
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

/**
 * Visible workspace rows only (Incoming / Tasks omitted).
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
    const workspaceChildren = node.isDir
      ? children.filter(
          (c) =>
            !isIncomingFolder(c.path, c.isDir) &&
            !isTasksFolder(c.path, c.isDir),
        )
      : [];
    const hasChildren = node.isDir && workspaceChildren.length > 0;
    out.push({
      path: node.path,
      name: node.name,
      isDir: node.isDir,
      hasChildren,
      depth,
      parentPath: parent,
      indexAmongSiblings: siblingIndex,
      droppable: node.isDir || isMdNestTarget(node.path, node.isDir),
    });

    const isOpen = node.path === VAULT_PATH || expanded.has(node.path);
    if (!node.isDir || !isOpen) return;

    workspaceChildren.forEach((child, i) => {
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
    const workspaceChildren = node.isDir
      ? children.filter(
          (c) =>
            !isIncomingFolder(c.path, c.isDir) &&
            !isTasksFolder(c.path, c.isDir),
        )
      : [];
    out.push({
      path: node.path,
      name: node.name,
      isDir: node.isDir,
      hasChildren: node.isDir && workspaceChildren.length > 0,
      depth,
      parentPath: parent,
      indexAmongSiblings: siblingIndex,
      droppable: node.isDir || isMdNestTarget(node.path, node.isDir),
    });
    if (!node.isDir) return;
    workspaceChildren.forEach((child, i) => {
      walk(child, depth + 1, node.path, i);
    });
  };
  walk(root, 0, "__tree_root__", 0);
  return out;
}

export function canDropVaultPath(
  from: string,
  targetPath: string,
  targetIsDir: boolean,
): boolean {
  if (!from) return false;
  if (from === targetPath) return false;
  if (targetPath.startsWith(`${from}/`)) return false;
  if (isIncomingFolder(from) || isTasksFolder(from)) return false;
  // Skills stays at vault root: only drop onto vault root.
  if (isSkillsFolder(from) && targetPath !== VAULT_PATH) return false;
  if (targetPath === VAULT_PATH) return true;
  if (targetIsDir) return true;
  if (isMdNestTarget(targetPath, false)) return true;
  return false;
}

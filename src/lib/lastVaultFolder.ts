import type { TreeNode } from "./vaultApi";

const STORAGE_KEY = "markspace.chat.lastVaultFolder";

export function getLastVaultFolder(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setLastVaultFolder(path: string): void {
  const rel = path.replace(/^\/+|\/+$/g, "");
  try {
    if (!rel) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, rel);
  } catch {
    /* ignore quota */
  }
}

export function findFolderInTree(
  root: TreeNode | null | undefined,
  folderPath: string,
): TreeNode | null {
  if (!root) return null;
  const rel = folderPath.replace(/^\/+|\/+$/g, "");
  if (!rel) return root;
  let cur: TreeNode = root;
  for (const part of rel.split("/").filter(Boolean)) {
    const next = (cur.children ?? []).find((c) => c.isDir && c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export function folderExistsInTree(
  root: TreeNode | null | undefined,
  folderPath: string,
): boolean {
  const rel = folderPath.replace(/^\/+|\/+$/g, "");
  if (!rel) return false;
  return findFolderInTree(root, rel) != null;
}

export function ancestorFolderPaths(folderPath: string): string[] {
  const parts = folderPath.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
    out.push(acc);
  }
  return out;
}

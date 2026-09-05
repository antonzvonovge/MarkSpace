import {
  FOLDER_NOTE_NAME,
  joinPath,
  parentPath,
  type TreeNode,
} from "./vaultApi";

function entryName(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** Remap `fromPrefix` → `toPrefix` on a subtree (move into another folder). */
export function remapSubtreePaths(
  node: TreeNode,
  fromPrefix: string,
  toPrefix: string,
): TreeNode {
  const path =
    node.path === fromPrefix
      ? toPrefix
      : node.path.startsWith(`${fromPrefix}/`)
        ? `${toPrefix}${node.path.slice(fromPrefix.length)}`
        : node.path;
  return {
    name: path === "" ? node.name : entryName(path),
    path,
    isDir: node.isDir,
    children: node.children?.map((c) =>
      remapSubtreePaths(c, fromPrefix, toPrefix),
    ),
  };
}

function extractNode(
  node: TreeNode,
  path: string,
): { tree: TreeNode; extracted: TreeNode } | null {
  if (!node.children?.length) return null;
  const idx = node.children.findIndex((c) => c.path === path);
  if (idx >= 0) {
    const extracted = node.children[idx]!;
    return {
      tree: {
        ...node,
        children: [
          ...node.children.slice(0, idx),
          ...node.children.slice(idx + 1),
        ],
      },
      extracted,
    };
  }
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    if (!child.isDir) continue;
    if (path !== child.path && !path.startsWith(`${child.path}/`)) continue;
    const sub = extractNode(child, path);
    if (!sub) continue;
    const children = node.children.slice();
    children[i] = sub.tree;
    return { tree: { ...node, children }, extracted: sub.extracted };
  }
  return null;
}

function insertNode(
  node: TreeNode,
  parentPathArg: string,
  child: TreeNode,
  toIndex: number,
): TreeNode | null {
  if (node.path === parentPathArg && node.isDir) {
    const children = [...(node.children ?? [])];
    const idx = Math.min(Math.max(0, toIndex), children.length);
    children.splice(idx, 0, child);
    return { ...node, children };
  }
  if (!node.children?.length) return null;
  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i]!;
    if (!c.isDir) continue;
    if (
      parentPathArg !== c.path &&
      !parentPathArg.startsWith(`${c.path}/`)
    ) {
      continue;
    }
    const next = insertNode(c, parentPathArg, child, toIndex);
    if (!next) continue;
    const children = node.children.slice();
    children[i] = next;
    return { ...node, children };
  }
  return null;
}

function findNode(node: TreeNode, path: string): TreeNode | null {
  if (node.path === path) return node;
  if (!node.children) return null;
  for (const c of node.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) {
      const hit = findNode(c, path);
      if (hit) return hit;
    }
  }
  return null;
}

/** Whether `path` exists anywhere in the vault tree. */
export function treeHasPath(root: TreeNode, path: string): boolean {
  return findNode(root, path) != null;
}

export function predictMovePath(from: string, toParent: string): string {
  const fromParent = parentPath(from);
  if (fromParent === toParent) return from;
  return joinPath(toParent, entryName(from));
}

/**
 * Local tree surgery mirroring `move_entry` (same-parent reorder or cross-folder).
 * Returns null when the move cannot be applied optimistically.
 */
export function optimisticMoveInTree(
  root: TreeNode,
  from: string,
  toParent: string,
  toIndex: number,
): { tree: TreeNode; nextPath: string } | null {
  if (!from || from === toParent) return null;
  if (toParent.startsWith(`${from}/`)) return null;

  const nextPath = predictMovePath(from, toParent);
  if (nextPath !== from && findNode(root, nextPath)) return null;

  const removed = extractNode(root, from);
  if (!removed) return null;

  let node = removed.extracted;
  if (nextPath !== from) {
    node = remapSubtreePaths(node, from, nextPath);
  }

  const inserted = insertNode(removed.tree, toParent, node, toIndex);
  if (!inserted) return null;
  return { tree: inserted, nextPath };
}

/** `Note.md` → folder path `Note` (same parent). */
export function notePathToFolderPath(notePath: string): string | null {
  if (!notePath || isFolderNoteName(notePath)) return null;
  if (!notePath.toLowerCase().endsWith(".md")) return null;
  return notePath.slice(0, -".md".length);
}

function isFolderNoteName(path: string): boolean {
  return entryName(path).toLowerCase() === FOLDER_NOTE_NAME;
}

/**
 * Local tree surgery for nest-under-note: promote note → folder, move `from` in.
 */
export function optimisticNestUnderNoteInTree(
  root: TreeNode,
  from: string,
  notePath: string,
  toIndex = 0,
): {
  tree: TreeNode;
  folder: string;
  folderNote: string;
  moved: string;
} | null {
  const folder = notePathToFolderPath(notePath);
  if (!folder) return null;
  if (!from || from === notePath) return null;
  if (from === folder || from.startsWith(`${folder}/`)) return null;
  if (notePath.startsWith(`${from}/`)) return null;

  const moved = joinPath(folder, entryName(from));
  const folderNote = joinPath(folder, FOLDER_NOTE_NAME);
  if (findNode(root, folder)) return null;

  const removedFrom = extractNode(root, from);
  if (!removedFrom) return null;

  const removedNote = extractNode(removedFrom.tree, notePath);
  if (!removedNote) return null;

  const movedNode = remapSubtreePaths(removedFrom.extracted, from, moved);
  const kids: TreeNode[] = [...(movedNode ? [movedNode] : [])];
  // Single child for a fresh folder; toIndex still respected for future multi-child.
  const idx = Math.min(Math.max(0, toIndex), kids.length);
  if (kids.length && idx !== 0) {
    const [only] = kids;
    kids.length = 0;
    kids.splice(idx, 0, only!);
  }

  const folderNode: TreeNode = {
    name: entryName(folder),
    path: folder,
    isDir: true,
    children: kids,
  };

  const noteParent = parentPath(notePath);
  // Insert folder where the note lived: append then we need sibling index of the note.
  // extract removed the note — insert at end of that parent's remaining children is wrong.
  // Re-insert using the note's former sibling index from the pre-extract tree.
  const noteSiblingIndex = (() => {
    const parent = findNode(removedFrom.tree, noteParent);
    if (!parent?.children) return 0;
    // After extracting `from`, note may still be present — index among then-siblings.
    const i = parent.children.findIndex((c) => c.path === notePath);
    return i >= 0 ? i : parent.children.length;
  })();

  const inserted = insertNode(
    removedNote.tree,
    noteParent,
    folderNode,
    noteSiblingIndex,
  );
  if (!inserted) return null;

  return {
    tree: inserted,
    folder,
    folderNote,
    moved,
  };
}

/**
 * Remove a node from the tree (structural share along the spine).
 * Returns null if the path is missing.
 */
export function optimisticRemoveFromTree(
  root: TreeNode,
  path: string,
): TreeNode | null {
  if (!path) return null;
  const removed = extractNode(root, path);
  return removed?.tree ?? null;
}

/**
 * Rename / rempath a node in place (same parent index).
 */
export function optimisticRenameInTree(
  root: TreeNode,
  from: string,
  to: string,
): TreeNode | null {
  if (!from || !to || from === to) return null;
  if (to.startsWith(`${from}/`)) return null;
  if (findNode(root, to)) return null;

  const parent = parentPath(from);
  const parentNode = findNode(root, parent);
  if (!parentNode?.children) return null;
  const siblingIndex = parentNode.children.findIndex((c) => c.path === from);
  if (siblingIndex < 0) return null;

  const removed = extractNode(root, from);
  if (!removed) return null;
  const renamed = remapSubtreePaths(removed.extracted, from, to);
  return insertNode(removed.tree, parent, renamed, siblingIndex);
}

/**
 * Insert a new leaf or folder under `parentPathArg` at `toIndex` (default: end).
 */
export function optimisticInsertInTree(
  root: TreeNode,
  parentPathArg: string,
  child: TreeNode,
  toIndex?: number,
): TreeNode | null {
  if (!child.path || findNode(root, child.path)) return null;
  const parent = findNode(root, parentPathArg);
  if (!parent?.isDir) return null;
  const idx =
    toIndex === undefined
      ? (parent.children?.length ?? 0)
      : toIndex;
  return insertNode(root, parentPathArg, child, idx);
}

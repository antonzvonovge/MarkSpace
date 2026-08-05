import type { CommentRef } from "./vaultApi";
import { parentPath } from "./vaultApi";

/**
 * Unresolved comment counts keyed by note path and every ancestor folder.
 * Folder count = sum of open comments under that path.
 */
export function buildUnresolvedCommentCounts(
  allComments: CommentRef[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of allComments) {
    if (ref.comment.resolved) continue;
    let path = ref.notePath;
    while (true) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      if (!path) break;
      const parent = parentPath(path);
      if (parent === path) break;
      path = parent;
    }
  }
  return counts;
}

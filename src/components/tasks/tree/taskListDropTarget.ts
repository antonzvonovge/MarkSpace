/** Attribute on sidebar list rows that accept a dragged task. */
export const TASK_LIST_DROP_ATTR = "data-task-list-drop";

/** Resolve which Tasks sidebar list is under the pointer (if any). */
export function taskListDropTargetAt(
  clientX: number,
  clientY: number,
): string | null {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if (!(el instanceof Element)) continue;
    const host = el.closest(`[${TASK_LIST_DROP_ATTR}]`);
    if (!host) continue;
    const list = host.getAttribute(TASK_LIST_DROP_ATTR)?.trim();
    if (list) return list;
  }
  return null;
}

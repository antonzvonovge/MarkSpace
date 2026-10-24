/** Attribute on sidebar list rows that accept a dragged task. */

export const TASK_LIST_DROP_ATTR = "data-task-list-drop";

function elementsAt(clientX: number, clientY: number): Element[] {
  if (typeof document.elementsFromPoint === "function") {
    return document.elementsFromPoint(clientX, clientY);
  }
  const el = document.elementFromPoint?.(clientX, clientY);
  return el instanceof Element ? [el] : [];
}

/** Resolve which Tasks sidebar list is under the pointer (if any). */
export function taskListDropTargetAt(
  clientX: number,
  clientY: number,
): string | null {
  for (const el of elementsAt(clientX, clientY)) {
    if (!(el instanceof Element)) continue;
    const host = el.closest(`[${TASK_LIST_DROP_ATTR}]`);
    if (!host) continue;
    const list = host.getAttribute(TASK_LIST_DROP_ATTR)?.trim();
    if (list) return list;
  }
  return null;
}

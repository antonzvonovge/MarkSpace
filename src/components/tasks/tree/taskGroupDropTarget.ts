/** Hit-test for in-list group section drop targets (outside SortableContext). */

export const TASK_GROUP_DROP_ATTR = "data-task-group-drop";

function elementsAt(clientX: number, clientY: number): Element[] {
  if (typeof document.elementsFromPoint === "function") {
    return document.elementsFromPoint(clientX, clientY);
  }
  const el = document.elementFromPoint?.(clientX, clientY);
  return el instanceof Element ? [el] : [];
}

export function taskGroupDropTargetAt(
  clientX: number,
  clientY: number,
): string | null {
  for (const el of elementsAt(clientX, clientY)) {
    if (!(el instanceof Element)) continue;
    const host = el.closest(`[${TASK_GROUP_DROP_ATTR}]`);
    if (!(host instanceof HTMLElement)) continue;
    const id = host.getAttribute(TASK_GROUP_DROP_ATTR);
    if (id && id.length > 0) return id;
  }
  return null;
}

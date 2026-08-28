import type { PanelGeometry } from "./panelGeometry";
import { readHostGeometry } from "./panelGeometry";

export function makeDraggable(
  host: HTMLElement,
  handle: HTMLElement,
  onGeometryChange?: (geometry: PanelGeometry) => void,
): () => void {
  let dragging = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const clamp = (left: number, top: number): { left: number; top: number } => {
    const margin = 8;
    const width = host.offsetWidth;
    const height = host.offsetHeight;
    return {
      left: Math.max(margin, Math.min(left, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
    };
  };

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Element;
    if (
      target.closest(
        ".chat-icon-btn, .chat-tab, .chat-tab-close, .chat-tab-scrollbar, .chat-tab-scrollbar-thumb, .chat-overlay-scrollbar, .chat-overlay-scrollbar-thumb, .chat-new-tab-wrap, .chat-new-tab-menu, .chat-new-tab-menu-item, .context-gem-resize-edge, button",
      )
    ) {
      return;
    }
    if (event.button !== 0) return;

    dragging = true;
    pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    handle.classList.add("is-dragging");

    const rect = host.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    host.style.setProperty("position", "fixed", "important");
    host.style.right = "auto";
    host.style.bottom = "auto";
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) return;

    const next = clamp(
      startLeft + (event.clientX - startX),
      startTop + (event.clientY - startY),
    );
    host.style.left = `${next.left}px`;
    host.style.top = `${next.top}px`;
  };

  const endDrag = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    handle.releasePointerCapture(pointerId);
    handle.classList.remove("is-dragging");
    pointerId = -1;
    onGeometryChange?.(readHostGeometry(host));
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  return () => {
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", endDrag);
    handle.removeEventListener("pointercancel", endDrag);
  };
}

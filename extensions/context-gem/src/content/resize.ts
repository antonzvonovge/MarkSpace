import {
  clampPanelGeometry,
  readHostGeometry,
  type PanelGeometry,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
} from "./panelGeometry";

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type ResizeOptions = {
  minWidth?: number;
  minHeight?: number;
  onGeometryChange?: (geometry: PanelGeometry) => void;
};

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const CURSOR: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  sw: "nesw-resize",
};

export function makePanelResizable(
  host: HTMLElement,
  mountRoot: HTMLElement,
  options: ResizeOptions = {},
): () => void {
  const minWidth = options.minWidth ?? PANEL_MIN_WIDTH;
  const minHeight = options.minHeight ?? PANEL_MIN_HEIGHT;
  const margin = 8;

  const handles: HTMLElement[] = [];
  for (const edge of EDGES) {
    const handle = document.createElement("div");
    handle.className = `context-gem-resize-edge context-gem-resize-edge--${edge}`;
    handle.dataset.edge = edge;
    handle.setAttribute("aria-hidden", "true");
    mountRoot.appendChild(handle);
    handles.push(handle);
  }

  let resizing = false;
  let pointerId = -1;
  let activeEdge: ResizeEdge | null = null;
  let activeHandle: HTMLElement | null = null;
  let startX = 0;
  let startY = 0;
  let startGeometry: PanelGeometry = { top: 0, left: 0, width: 0, height: 0 };

  const notifyChange = (): void => {
    options.onGeometryChange?.(readHostGeometry(host));
  };

  const applyGeometry = (geometry: PanelGeometry): void => {
    const next = clampPanelGeometry(geometry, minWidth, minHeight);
    host.style.top = `${next.top}px`;
    host.style.left = `${next.left}px`;
    host.style.width = `${next.width}px`;
    host.style.height = `${next.height}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const edge = handle.dataset.edge as ResizeEdge | undefined;
    if (!edge) return;

    resizing = true;
    activeEdge = edge;
    activeHandle = handle;
    pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    handle.classList.add("is-resizing");
    mountRoot.classList.add("is-resizing");

    startX = event.clientX;
    startY = event.clientY;
    startGeometry = readHostGeometry(host);

    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!resizing || event.pointerId !== pointerId || !activeEdge) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const maxWidth = window.innerWidth - margin * 2;
    const maxHeight = window.innerHeight - margin * 2;

    let top = startGeometry.top;
    let left = startGeometry.left;
    let width = startGeometry.width;
    let height = startGeometry.height;

    if (activeEdge.includes("e")) {
      width = Math.min(maxWidth, Math.max(minWidth, startGeometry.width + dx));
    }
    if (activeEdge.includes("w")) {
      width = Math.min(maxWidth, Math.max(minWidth, startGeometry.width - dx));
      left = startGeometry.left + (startGeometry.width - width);
    }
    if (activeEdge.includes("s")) {
      height = Math.min(
        maxHeight,
        Math.max(minHeight, startGeometry.height + dy),
      );
    }
    if (activeEdge.includes("n")) {
      height = Math.min(
        maxHeight,
        Math.max(minHeight, startGeometry.height - dy),
      );
      top = startGeometry.top + (startGeometry.height - height);
    }

    applyGeometry({ top, left, width, height });
  };

  const endResize = (event: PointerEvent): void => {
    if (!resizing || event.pointerId !== pointerId) return;
    resizing = false;
    activeEdge = null;
    activeHandle?.releasePointerCapture(pointerId);
    activeHandle?.classList.remove("is-resizing");
    activeHandle = null;
    mountRoot.classList.remove("is-resizing");
    pointerId = -1;
    notifyChange();
  };

  for (const handle of handles) {
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", endResize);
    handle.addEventListener("pointercancel", endResize);
  }

  return () => {
    for (const handle of handles) {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endResize);
      handle.removeEventListener("pointercancel", endResize);
      handle.remove();
    }
  };
}

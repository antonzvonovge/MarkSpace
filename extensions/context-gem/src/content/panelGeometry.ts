export type PanelGeometry = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export const DEFAULT_PANEL_WIDTH = 400;
export const DEFAULT_PANEL_HEIGHT = 520;

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 360;

const VIEWPORT_MARGIN = 8;

export function clampPanelGeometry(
  geometry: PanelGeometry,
  minWidth = PANEL_MIN_WIDTH,
  minHeight = PANEL_MIN_HEIGHT,
): PanelGeometry {
  const maxWidth = Math.max(
    minWidth,
    window.innerWidth - VIEWPORT_MARGIN * 2,
  );
  const maxHeight = Math.max(
    minHeight,
    window.innerHeight - VIEWPORT_MARGIN * 2,
  );

  const width = Math.min(maxWidth, Math.max(minWidth, geometry.width));
  const height = Math.min(maxHeight, Math.max(minHeight, geometry.height));

  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
  const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;

  return {
    width,
    height,
    left: Math.max(VIEWPORT_MARGIN, Math.min(geometry.left, maxLeft)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(geometry.top, maxTop)),
  };
}

export function defaultPanelGeometry(): PanelGeometry {
  const width = Math.min(DEFAULT_PANEL_WIDTH, window.innerWidth - 24);
  const height = Math.min(DEFAULT_PANEL_HEIGHT, window.innerHeight - 24);
  return clampPanelGeometry({
    top: Math.max(12, (window.innerHeight - height) / 2),
    left: Math.max(12, (window.innerWidth - width) / 2),
    width,
    height,
  });
}

export function readHostGeometry(host: HTMLElement): PanelGeometry {
  const rect = host.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function applyHostGeometry(host: HTMLElement, geometry: PanelGeometry): void {
  host.style.setProperty("position", "fixed", "important");
  host.style.setProperty("z-index", "2147483646", "important");
  host.style.top = `${geometry.top}px`;
  host.style.left = `${geometry.left}px`;
  host.style.width = `${geometry.width}px`;
  host.style.height = `${geometry.height}px`;
  host.style.margin = "0";
  host.style.padding = "0";
  host.style.border = "0";
  host.style.boxSizing = "border-box";
  host.style.pointerEvents = "auto";
  host.style.display = "block";
  host.style.right = "auto";
  host.style.bottom = "auto";
}

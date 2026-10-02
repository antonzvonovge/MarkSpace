/** On-disk JSON for a MarkSpace `.dashboard` file. */

import { z } from "zod";
import {
  PROJECT_COLOR_SWATCHES,
  normalizeProjectColor,
} from "./projectColors";

export const DASHBOARD_VERSION = 1;
export const DASHBOARD_COLS = 12;
export const DASHBOARD_WIDGET_W = 6;
export const DASHBOARD_WIDGET_H = 4;

/** Saturated swatches. Lime and amber disappear on the light sidebar. */
const DASHBOARD_ICON_COLORS = PROJECT_COLOR_SWATCHES.flatMap((swatch) =>
  swatch.hex === "#cddc39" || swatch.hex === "#ffc107" ? [] : [swatch.hex],
);

/** Palette color stored on the file at creation. Stable after that. */
export function pickDashboardColor(): string {
  const index = Math.floor(Math.random() * DASHBOARD_ICON_COLORS.length);
  return DASHBOARD_ICON_COLORS[index] ?? DASHBOARD_ICON_COLORS[0];
}

const routineWidgetSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.literal("routine"),
  routineId: z.string().trim().min(1),
  x: z.number().int().min(0).max(DASHBOARD_COLS - 1),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(DASHBOARD_COLS),
  h: z.number().int().min(1).max(40),
});

const dashboardSchema = z.object({
  version: z.literal(DASHBOARD_VERSION),
  cols: z.literal(DASHBOARD_COLS),
  color: z.string().optional(),
  widgets: z.array(routineWidgetSchema).max(40),
});

export type RoutineWidget = z.infer<typeof routineWidgetSchema>;
export type DashboardWidget = RoutineWidget;
export type DashboardDoc = Omit<z.infer<typeof dashboardSchema>, "color"> & {
  /** Palette hex, or "" until the file is assigned a color. */
  color: string;
};

export type GridCell = { x: number; y: number; w: number; h: number };

export function emptyDashboardDoc(color = ""): DashboardDoc {
  return {
    version: DASHBOARD_VERSION,
    cols: DASHBOARD_COLS,
    color: normalizeProjectColor(color),
    widgets: [],
  };
}

export function emptyDashboard(color = ""): string {
  return serializeDashboard(emptyDashboardDoc(color));
}

export function serializeDashboard(doc: DashboardDoc): string {
  const color = normalizeProjectColor(doc.color);
  return `${JSON.stringify(
    {
      version: doc.version,
      cols: doc.cols,
      ...(color ? { color } : {}),
      widgets: doc.widgets,
    },
    null,
    2,
  )}\n`;
}

export function parseDashboard(raw: string): DashboardDoc {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Dashboard file is not valid JSON");
  }
  const parsed = dashboardSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Dashboard file does not match the dashboard format");
  }
  const ids = new Set<string>();
  for (const widget of parsed.data.widgets) {
    if (widget.x + widget.w > DASHBOARD_COLS) {
      throw new Error(`Widget ${widget.id} extends past the grid`);
    }
    if (ids.has(widget.id)) {
      throw new Error(`Duplicate widget id ${widget.id}`);
    }
    ids.add(widget.id);
  }
  return { ...parsed.data, color: normalizeProjectColor(parsed.data.color) };
}

function cellsOverlap(a: GridCell, b: GridCell): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** First free 6×4 cell, scanning rows left to right. */
export function findFreeCell(
  widgets: readonly GridCell[],
  cols = DASHBOARD_COLS,
): GridCell {
  const w = Math.min(DASHBOARD_WIDGET_W, cols);
  const h = DASHBOARD_WIDGET_H;
  const limit = widgets.reduce((max, item) => Math.max(max, item.y + item.h), 0) + h;
  for (let y = 0; y <= limit; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const cell = { x, y, w, h };
      if (!widgets.some((item) => cellsOverlap(cell, item))) return cell;
    }
  }
  return { x: 0, y: limit, w, h };
}

export function placeRoutineWidget(
  doc: DashboardDoc,
  routineId: string,
  id: string,
): DashboardDoc {
  const cell = findFreeCell(doc.widgets, doc.cols);
  return {
    ...doc,
    widgets: [...doc.widgets, { id, kind: "routine", routineId, ...cell }],
  };
}

export function removeWidget(doc: DashboardDoc, id: string): DashboardDoc {
  return { ...doc, widgets: doc.widgets.filter((widget) => widget.id !== id) };
}

export function applyGridLayout(
  doc: DashboardDoc,
  layout: readonly { i: string; x: number; y: number; w: number; h: number }[],
): DashboardDoc {
  const byId = new Map(layout.map((item) => [item.i, item]));
  return {
    ...doc,
    widgets: doc.widgets.map((widget) => {
      const item = byId.get(widget.id);
      if (!item) return widget;
      return { ...widget, x: item.x, y: item.y, w: item.w, h: item.h };
    }),
  };
}

/** Drop the run-file heading and Trigger/Status lines. Cap length for the widget body. */
export function previewRoutineReport(
  markdown: string,
  limit = 8000,
): { text: string; truncated: boolean } {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  if (lines[0]?.startsWith("# ")) index = 1;
  while (index < lines.length && lines[index]?.trim() === "") index += 1;
  while (index < lines.length && /^- (Trigger|Status):/.test(lines[index] ?? "")) {
    index += 1;
  }
  while (index < lines.length && lines[index]?.trim() === "") index += 1;
  const body = lines.slice(index).join("\n").trim();
  if (body.length <= limit) return { text: body, truncated: false };
  return { text: body.slice(0, limit).trimEnd(), truncated: true };
}

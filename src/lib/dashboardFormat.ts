/** On-disk JSON for a MarkSpace `.dashboard` file. */

import { z } from "zod";
import {
  PROJECT_COLOR_SWATCHES,
  normalizeProjectColor,
} from "./projectColors";
import type { WeatherPlace } from "./weather";

export const DASHBOARD_VERSION = 1;
export const DASHBOARD_COLS = 12;
export const DASHBOARD_WIDGET_W = 6;
export const DASHBOARD_WIDGET_H = 4;
export const DASHBOARD_WEATHER_W = 4;
export const DASHBOARD_WEATHER_H = 5;
export const DASHBOARD_TASKS_W = 6;
export const DASHBOARD_TASKS_H = 6;
export const DASHBOARD_NOTE_W = 6;
export const DASHBOARD_NOTE_H = 6;

/** Saturated swatches. Lime and amber disappear on the light sidebar. */
const DASHBOARD_ICON_COLORS = PROJECT_COLOR_SWATCHES.flatMap((swatch) =>
  swatch.hex === "#cddc39" || swatch.hex === "#ffc107" ? [] : [swatch.hex],
);

/** Palette color stored on the file at creation. Stable after that. */
export function pickDashboardColor(): string {
  const index = Math.floor(Math.random() * DASHBOARD_ICON_COLORS.length);
  return DASHBOARD_ICON_COLORS[index] ?? DASHBOARD_ICON_COLORS[0];
}

const widgetId = z.string().trim().min(1).max(80);
const gridTail = {
  x: z.number().int().min(0).max(DASHBOARD_COLS - 1),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(DASHBOARD_COLS),
  h: z.number().int().min(1).max(40),
};

const routineWidgetSchema = z.object({
  id: widgetId,
  kind: z.literal("routine"),
  routineId: z.string().trim().min(1),
  ...gridTail,
});

const weatherWidgetSchema = z
  .object({
    id: widgetId,
    kind: z.literal("weather"),
    /** City name. Empty until the user picks a place. */
    place: z.string().trim().max(120),
    admin: z.string().trim().max(120).optional(),
    country: z.string().trim().max(80).optional(),
    latitude: z.number().gte(-90).lte(90).optional(),
    longitude: z.number().gte(-180).lte(180).optional(),
    ...gridTail,
  })
  .superRefine((widget, ctx) => {
    const hasLat = widget.latitude !== undefined;
    const hasLon = widget.longitude !== undefined;
    if (hasLat !== hasLon || (widget.place.length > 0) !== hasLat) {
      ctx.addIssue({
        code: "custom",
        message: "Weather widget needs a place and both coordinates",
      });
    }
  });

const tasksWidgetSchema = z.object({
  id: widgetId,
  kind: z.literal("tasks"),
  /** Task list folder under Tasks/. Empty for Today / Overdue, or until a list is picked. */
  list: z.string().trim().max(200),
  /** Smart view. When set, `list` is ignored. */
  view: z.enum(["today", "overdue"]).optional(),
  ...gridTail,
});

/** Absolute file path from the system dialog, a vault-relative `.md` path, or empty. */
export function isDashboardNotePath(path: string): boolean {
  if (!path) return true;
  if (path.includes("\0")) return false;
  if (path.startsWith("/") || path.startsWith("\\\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (path.split("/").includes("..")) return false;
  return path.toLowerCase().endsWith(".md");
}

const noteWidgetSchema = z
  .object({
    id: widgetId,
    kind: z.literal("note"),
    /** Absolute path. Empty until the user picks a file. */
    path: z.string().trim().max(4096),
    ...gridTail,
  })
  .superRefine((widget, ctx) => {
    if (!isDashboardNotePath(widget.path)) {
      ctx.addIssue({
        code: "custom",
        message: "Note widget needs a file path",
      });
    }
  });

const widgetSchema = z.discriminatedUnion("kind", [
  routineWidgetSchema,
  weatherWidgetSchema,
  tasksWidgetSchema,
  noteWidgetSchema,
]);

const dashboardSchema = z.object({
  version: z.literal(DASHBOARD_VERSION),
  cols: z.literal(DASHBOARD_COLS),
  color: z.string().optional(),
  widgets: z.array(widgetSchema).max(40),
});

export type RoutineWidget = z.infer<typeof routineWidgetSchema>;
export type WeatherWidget = z.infer<typeof weatherWidgetSchema>;
export type TasksWidget = z.infer<typeof tasksWidgetSchema>;
export type NoteWidget = z.infer<typeof noteWidgetSchema>;
export type TasksWidgetSource =
  | { view: "today" | "overdue" }
  | { list: string };
export type DashboardWidget = z.infer<typeof widgetSchema>;
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

/** First free cell of the given size, scanning rows left to right. */
export function findFreeCell(
  widgets: readonly GridCell[],
  cols = DASHBOARD_COLS,
  size: { w: number; h: number } = { w: DASHBOARD_WIDGET_W, h: DASHBOARD_WIDGET_H },
): GridCell {
  const w = Math.min(size.w, cols);
  const h = size.h;
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

function roundCoord(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function placeWeatherWidget(doc: DashboardDoc, id: string): DashboardDoc {
  const cell = findFreeCell(doc.widgets, doc.cols, {
    w: DASHBOARD_WEATHER_W,
    h: DASHBOARD_WEATHER_H,
  });
  return {
    ...doc,
    widgets: [...doc.widgets, { id, kind: "weather", place: "", ...cell }],
  };
}

export function setWeatherPlace(
  doc: DashboardDoc,
  id: string,
  place: WeatherPlace,
): DashboardDoc {
  return {
    ...doc,
    widgets: doc.widgets.map((widget) => {
      if (widget.id !== id || widget.kind !== "weather") return widget;
      return {
        id: widget.id,
        kind: "weather",
        place: place.name,
        ...(place.admin ? { admin: place.admin } : {}),
        ...(place.country ? { country: place.country } : {}),
        latitude: roundCoord(place.latitude),
        longitude: roundCoord(place.longitude),
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      };
    }),
  };
}

export function placeTasksWidget(doc: DashboardDoc, id: string): DashboardDoc {
  const cell = findFreeCell(doc.widgets, doc.cols, {
    w: DASHBOARD_TASKS_W,
    h: DASHBOARD_TASKS_H,
  });
  return {
    ...doc,
    widgets: [...doc.widgets, { id, kind: "tasks", list: "", ...cell }],
  };
}

export function setTasksSource(
  doc: DashboardDoc,
  id: string,
  source: TasksWidgetSource,
): DashboardDoc {
  return {
    ...doc,
    widgets: doc.widgets.map((widget) => {
      if (widget.id !== id || widget.kind !== "tasks") return widget;
      const grid = {
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      };
      if ("view" in source) {
        return {
          id: widget.id,
          kind: "tasks" as const,
          list: "",
          view: source.view,
          ...grid,
        };
      }
      return {
        id: widget.id,
        kind: "tasks" as const,
        list: source.list.trim(),
        ...grid,
      };
    }),
  };
}

export function placeNoteWidget(doc: DashboardDoc, id: string): DashboardDoc {
  const cell = findFreeCell(doc.widgets, doc.cols, {
    w: DASHBOARD_NOTE_W,
    h: DASHBOARD_NOTE_H,
  });
  return {
    ...doc,
    widgets: [...doc.widgets, { id, kind: "note", path: "", ...cell }],
  };
}

export function setNotePath(doc: DashboardDoc, id: string, path: string): DashboardDoc {
  const nextPath = path.trim();
  if (!isDashboardNotePath(nextPath)) return doc;
  return {
    ...doc,
    widgets: doc.widgets.map((widget) => {
      if (widget.id !== id || widget.kind !== "note") return widget;
      return { ...widget, path: nextPath };
    }),
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

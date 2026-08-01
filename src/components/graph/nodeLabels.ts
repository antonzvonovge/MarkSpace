import type { Attributes } from "graphology-types";
import type { NodeHoverDrawingFunction, NodeLabelDrawingFunction } from "sigma/rendering";
import type { Settings } from "sigma/settings";
import type { NodeDisplayData, PartialButFor } from "sigma/types";
import { withAlpha, type GraphTheme } from "./graphTheme";

/** Label column width in screen pixels — wide enough for ~2 words per line. */
const LABEL_MAX_WIDTH = 128;
const LABEL_MAX_LINES = 4;
const LINE_GAP = 2;
/** Distance between the circle edge and the first line of text. */
const LABEL_OFFSET = 6;
const HOVER_PADDING = 6;

type LabelData = PartialButFor<
  NodeDisplayData,
  "x" | "y" | "size" | "label" | "color"
>;

/**
 * Greedy word wrap within `maxWidth`, hard-breaking words that do not fit on a
 * line of their own. Anything past `maxLines` collapses into a trailing ellipsis.
 */
function wrapLabel(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = "";

  const start = (word: string) => {
    let rest = word;
    while (rest.length > 1 && context.measureText(rest).width > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && context.measureText(rest.slice(0, cut)).width > maxWidth) {
        cut--;
      }
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!current) {
      start(word);
      continue;
    }
    const candidate = `${current} ${word}`;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      start(word);
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  let last = clipped[maxLines - 1] ?? "";
  while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1);
  }
  clipped[maxLines - 1] = `${last.trimEnd()}…`;
  return clipped;
}

function labelLines(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings<Attributes, Attributes, Attributes>,
): string[] {
  if (typeof data.label !== "string" || !data.label) return [];
  context.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  return wrapLabel(context, data.label, LABEL_MAX_WIDTH, LABEL_MAX_LINES);
}

function paintLines(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings<Attributes, Attributes, Attributes>,
  lines: string[],
  color: string,
): void {
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "top";
  const top = data.y + data.size + LABEL_OFFSET;
  lines.forEach((line, i) => {
    context.fillText(line, data.x, top + i * (settings.labelSize + LINE_GAP));
  });
  // Canvas state is shared with sigma's other renderers.
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

/**
 * Label renderers bound to the live theme: sigma keeps the functions from the
 * settings it was built with, so the theme is read through a getter.
 */
export function createNodeLabelRenderers<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
>(
  getTheme: () => GraphTheme,
): {
  drawLabel: NodeLabelDrawingFunction<N, E, G>;
  drawHover: NodeHoverDrawingFunction<N, E, G>;
} {
  const drawLabel = (
    context: CanvasRenderingContext2D,
    data: LabelData,
    settings: Settings<Attributes, Attributes, Attributes>,
  ): void => {
    const lines = labelLines(context, data, settings);
    if (!lines.length) return;
    const attribute = settings.labelColor.attribute;
    const color =
      (attribute
        ? ((data as Record<string, unknown>)[attribute] as string | undefined)
        : undefined) ??
      settings.labelColor.color ??
      "#000";
    paintLines(context, data, settings, lines, color);
  };

  const drawHover = (
    context: CanvasRenderingContext2D,
    data: LabelData,
    settings: Settings<Attributes, Attributes, Attributes>,
  ): void => {
    const lines = labelLines(context, data, settings);
    if (!lines.length) return;
    const theme = getTheme();
    const lineHeight = settings.labelSize + LINE_GAP;
    const width =
      Math.max(...lines.map((line) => context.measureText(line).width)) +
      HOVER_PADDING * 2;
    const height = lines.length * lineHeight - LINE_GAP + HOVER_PADDING * 2;
    const top = data.y + data.size + LABEL_OFFSET - HOVER_PADDING;

    context.fillStyle = theme.surface;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 1;
    context.shadowBlur = 8;
    context.shadowColor = withAlpha(theme.text, 0.25);
    roundedRect(context, data.x - width / 2, top, width, height, 6);
    context.fill();
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.shadowColor = "transparent";

    paintLines(context, data, settings, lines, theme.text);
  };

  return {
    drawLabel: drawLabel as NodeLabelDrawingFunction<N, E, G>,
    drawHover: drawHover as NodeHoverDrawingFunction<N, E, G>,
  };
}

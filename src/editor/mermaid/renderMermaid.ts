import {
  diagramCacheKey,
  getOrRenderDiagramSvg,
  type DiagramSkin,
} from "../diagramCache";

let mermaidReady: Promise<typeof import("mermaid")> | null = null;
let lastConfigKey: string | null = null;

function loadMermaid() {
  if (!mermaidReady) mermaidReady = import("mermaid");
  return mermaidReady;
}

/**
 * Mermaid's wrapLabel bails out entirely when a label already contains `<br>`,
 * so one long line after a manual break still stretches that actor pair.
 * Strip breaks in sequence diagrams — config `sequence.wrap` reflows for us.
 */
function prepareSequenceSource(code: string): string {
  const body = code.replace(/^\s*%%\{[\s\S]*?\}%%\s*/m, "");
  if (!/^\s*sequenceDiagram\b/m.test(body)) return code;
  return code.replace(/<br\s*\/?>/gi, " ");
}

/** Shared sequence layout: equal lifeline columns, wrap long text. */
const SEQUENCE_LAYOUT = {
  wrap: true,
  width: 200,
  wrapPadding: 10,
  // Distance between actor boxes (not centers) — larger = clearer columns.
  actorMargin: 72,
  boxMargin: 6,
  boxTextMargin: 4,
  noteMargin: 10,
  messageMargin: 32,
  messageAlign: "left" as const,
  useMaxWidth: false,
};


/** Cursor Plan–like muted zinc; compact type + clearer edges. */
const NEUTRAL_LIGHT = {
  darkMode: false,
  background: "#ffffff",
  mainBkg: "#f4f4f5",
  primaryColor: "#f4f4f5",
  primaryTextColor: "#27272a",
  primaryBorderColor: "#a1a1aa",
  secondaryColor: "#e4e4e7",
  secondaryTextColor: "#27272a",
  secondaryBorderColor: "#a1a1aa",
  tertiaryColor: "#fafafa",
  tertiaryTextColor: "#3f3f46",
  tertiaryBorderColor: "#d4d4d8",
  lineColor: "#71717a",
  textColor: "#3f3f46",
  titleColor: "#52525b",
  nodeBorder: "#a1a1aa",
  nodeTextColor: "#27272a",
  clusterBkg: "#fafafa",
  clusterBorder: "#d4d4d8",
  edgeLabelBackground: "#ffffff",
  actorBkg: "#f4f4f5",
  actorBorder: "#a1a1aa",
  actorTextColor: "#27272a",
  actorLineColor: "#71717a",
  signalColor: "#52525b",
  signalTextColor: "#3f3f46",
  labelBoxBkgColor: "#f4f4f5",
  labelBoxBorderColor: "#a1a1aa",
  labelTextColor: "#27272a",
  loopTextColor: "#3f3f46",
  noteBkgColor: "#fafafa",
  noteTextColor: "#3f3f46",
  noteBorderColor: "#d4d4d8",
  activationBkgColor: "#e4e4e7",
  activationBorderColor: "#71717a",
  sequenceNumberColor: "#ffffff",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", "Ubuntu", system-ui, sans-serif',
  fontSize: "12px",
};

const NEUTRAL_DARK = {
  ...NEUTRAL_LIGHT,
  darkMode: true,
  background: "#18181b",
  mainBkg: "#27272a",
  primaryColor: "#27272a",
  primaryTextColor: "#f4f4f5",
  primaryBorderColor: "#71717a",
  secondaryColor: "#3f3f46",
  secondaryTextColor: "#f4f4f5",
  secondaryBorderColor: "#71717a",
  tertiaryColor: "#1f1f23",
  tertiaryTextColor: "#d4d4d8",
  tertiaryBorderColor: "#52525b",
  lineColor: "#a1a1aa",
  textColor: "#d4d4d8",
  titleColor: "#a1a1aa",
  nodeBorder: "#71717a",
  nodeTextColor: "#f4f4f5",
  clusterBkg: "#1f1f23",
  clusterBorder: "#52525b",
  edgeLabelBackground: "#27272a",
  actorBkg: "#27272a",
  actorBorder: "#71717a",
  actorTextColor: "#f4f4f5",
  actorLineColor: "#a1a1aa",
  signalColor: "#d4d4d8",
  signalTextColor: "#e4e4e7",
  labelBoxBkgColor: "#27272a",
  labelBoxBorderColor: "#71717a",
  labelTextColor: "#f4f4f5",
  loopTextColor: "#d4d4d8",
  noteBkgColor: "#1f1f23",
  noteTextColor: "#d4d4d8",
  noteBorderColor: "#52525b",
  activationBkgColor: "#3f3f46",
  activationBorderColor: "#a1a1aa",
};

async function renderMermaidUncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
  renderId: string,
): Promise<string> {
  const { default: mermaid } = await loadMermaid();
  const configKey = `${skin}:${dark ? "1" : "0"}:compact9`;
  if (lastConfigKey !== configKey) {
    if (skin === "neutral") {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Keep parse failures as thrown errors only — never inject Mermaid's
        // full-viewport "Syntax error in text" SVG into the document body.
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: dark ? NEUTRAL_DARK : NEUTRAL_LIGHT,
        // useMaxWidth:false — keep intrinsic px size; chat CSS only shrinks if needed.
        // Stretching to 100% was making boxes/fonts look huge in the chat column.
        flowchart: {
          htmlLabels: true,
          curve: "basis",
          padding: 12,
          nodeSpacing: 24,
          rankSpacing: 40,
          wrappingWidth: 160,
          useMaxWidth: false,
          // >0 reserves space so nested nodes don't cover subgraph titles.
          subGraphTitleMargin: { top: 6, bottom: 14 },
        },
        sequence: { ...SEQUENCE_LAYOUT },
        er: { useMaxWidth: false },
        journey: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        pie: { useMaxWidth: false },
        quadrantChart: { useMaxWidth: false },
        xyChart: { useMaxWidth: false },
      });
    } else {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: dark ? "dark" : "default",
        sequence: { ...SEQUENCE_LAYOUT },
      });
    }
    lastConfigKey = configKey;
  }
  const { svg } = await mermaid.render(
    renderId,
    prepareSequenceSource(code),
  );
  return svg;
}

let renderSeq = 0;

export function renderMermaidToSvg(
  code: string,
  dark: boolean,
  skin: DiagramSkin = "default",
): Promise<string> {
  const trimmed = code.trim();
  const key = diagramCacheKey("mermaid", trimmed, dark, skin);
  return getOrRenderDiagramSvg(key, () => {
    renderSeq += 1;
    const renderId = `ms-mermaid-${renderSeq}-${Date.now()}`;
    return renderMermaidUncached(trimmed, dark, skin, renderId);
  });
}

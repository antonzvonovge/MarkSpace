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

/** Cursor-like muted grays; compact type + spacing for chat. */
const NEUTRAL_LIGHT = {
  darkMode: false,
  background: "#ffffff",
  mainBkg: "#f4f4f5",
  primaryColor: "#f4f4f5",
  primaryTextColor: "#3f3f46",
  primaryBorderColor: "#d4d4d8",
  secondaryColor: "#e4e4e7",
  secondaryTextColor: "#3f3f46",
  secondaryBorderColor: "#d4d4d8",
  tertiaryColor: "#fafafa",
  tertiaryTextColor: "#52525b",
  tertiaryBorderColor: "#e4e4e7",
  lineColor: "#a1a1aa",
  textColor: "#52525b",
  titleColor: "#71717a",
  nodeBorder: "#d4d4d8",
  nodeTextColor: "#3f3f46",
  clusterBkg: "#fafafa",
  clusterBorder: "#e4e4e7",
  edgeLabelBackground: "#ffffff",
  actorBkg: "#f4f4f5",
  actorBorder: "#d4d4d8",
  actorTextColor: "#3f3f46",
  actorLineColor: "#a1a1aa",
  signalColor: "#71717a",
  signalTextColor: "#52525b",
  labelBoxBkgColor: "#f4f4f5",
  labelBoxBorderColor: "#d4d4d8",
  labelTextColor: "#3f3f46",
  loopTextColor: "#52525b",
  noteBkgColor: "#fafafa",
  noteTextColor: "#52525b",
  noteBorderColor: "#e4e4e7",
  activationBkgColor: "#e4e4e7",
  activationBorderColor: "#a1a1aa",
  sequenceNumberColor: "#ffffff",
  fontFamily:
    '"Ubuntu", -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Droid Sans", sans-serif',
  fontSize: "10px",
};

const NEUTRAL_DARK = {
  ...NEUTRAL_LIGHT,
  darkMode: true,
  background: "#18181b",
  mainBkg: "#27272a",
  primaryColor: "#27272a",
  primaryTextColor: "#e4e4e7",
  primaryBorderColor: "#52525b",
  secondaryColor: "#3f3f46",
  secondaryTextColor: "#e4e4e7",
  secondaryBorderColor: "#52525b",
  tertiaryColor: "#1f1f23",
  tertiaryTextColor: "#a1a1aa",
  tertiaryBorderColor: "#3f3f46",
  lineColor: "#71717a",
  textColor: "#a1a1aa",
  titleColor: "#a1a1aa",
  nodeBorder: "#52525b",
  nodeTextColor: "#e4e4e7",
  clusterBkg: "#1f1f23",
  clusterBorder: "#3f3f46",
  edgeLabelBackground: "#27272a",
  actorBkg: "#27272a",
  actorBorder: "#52525b",
  actorTextColor: "#e4e4e7",
  actorLineColor: "#71717a",
  signalColor: "#a1a1aa",
  signalTextColor: "#d4d4d8",
  labelBoxBkgColor: "#27272a",
  labelBoxBorderColor: "#52525b",
  labelTextColor: "#e4e4e7",
  loopTextColor: "#a1a1aa",
  noteBkgColor: "#1f1f23",
  noteTextColor: "#a1a1aa",
  noteBorderColor: "#3f3f46",
  activationBkgColor: "#3f3f46",
  activationBorderColor: "#71717a",
};

async function renderMermaidUncached(
  code: string,
  dark: boolean,
  skin: DiagramSkin,
  renderId: string,
): Promise<string> {
  const { default: mermaid } = await loadMermaid();
  const configKey = `${skin}:${dark ? "1" : "0"}:compact6`;
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
          padding: 10,
          nodeSpacing: 20,
          rankSpacing: 44,
          wrappingWidth: 128,
          useMaxWidth: false,
          // >0 reserves space so nested nodes don't cover subgraph titles.
          subGraphTitleMargin: { top: 6, bottom: 14 },
        },
        sequence: {
          actorMargin: 16,
          boxMargin: 3,
          boxTextMargin: 2,
          noteMargin: 4,
          messageMargin: 20,
          useMaxWidth: false,
        },
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
      });
    }
    lastConfigKey = configKey;
  }
  const { svg } = await mermaid.render(renderId, code);
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

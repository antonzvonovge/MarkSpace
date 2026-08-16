import { buildDrawioEmbedUrl, EMPTY_DRAWIO_XML } from "../../editor/drawio/constants";
import { mxfilePageIsEmpty, mxGraphModelIsEmpty, wrapContentAsMxfile } from "./pages";

type PendingConvert = {
  run: (win: DrawioWin) => Promise<string>;
  resolve: (xml: string) => void;
  reject: (err: Error) => void;
  timer: number;
};

type DrawioWin = Window & {
  mermaid?: { mermaidAPI?: unknown };
  mxMermaidToDrawio?: {
    addListener: (fn: (xml: string) => void) => void;
    resetListeners: () => void;
    htmlLabels?: boolean;
  };
  EditorUi?: {
    prototype: {
      createLoadMessage?: (...args: unknown[]) => unknown;
      emptyDiagramXml?: string;
    };
  };
};

type EditorUiHandle = {
  generateMermaidImage: (
    data: string,
    config: unknown,
    success: (data: string, w: number, h: number) => void,
    error: (e: unknown) => void,
  ) => void;
  createMermaidXml?: (
    input: string,
    config: unknown,
    data: string,
    w: number,
    h: number,
  ) => string;
};

export type MermaidLayoutKind = "flow" | "fixed" | "other";

export const EMPTY_PAINT_ERROR =
  "draw.io first paint produced an empty diagram (no shapes). The bundled editor does not treat Mermaid source as XML — conversion must go through mermaid.js.";

let iframe: HTMLIFrameElement | null = null;
let ready = false;
let queue: PendingConvert[] = [];
let active: PendingConvert | null = null;
let capturedUi: EditorUiHandle | null = null;
let mermaidLibs: Promise<void> | null = null;

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;
  const el = document.createElement("iframe");
  el.title = "drawio-first-paint";
  el.setAttribute("aria-hidden", "true");
  // Real viewport: mermaid/ELK measure clientWidth; 1×1 yields empty graphs.
  el.style.cssText =
    "position:fixed;width:640px;height:480px;left:-2000px;top:0;opacity:0;pointer-events:none;border:0";
  el.src = buildDrawioEmbedUrl({ libraries: false });
  document.body.appendChild(el);
  iframe = el;
  window.addEventListener("message", onMessage);
  return el;
}

function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function post(action: Record<string, unknown>) {
  iframe?.contentWindow?.postMessage(JSON.stringify(action), "*");
}

function drawioWindow(): DrawioWin | null {
  return (iframe?.contentWindow as DrawioWin | null) ?? null;
}

function hookEditorUi(win: DrawioWin) {
  const flagged = win as DrawioWin & { __msUiHooked?: boolean };
  if (flagged.__msUiHooked) return;
  const proto = win.EditorUi?.prototype;
  if (!proto?.createLoadMessage) return;
  flagged.__msUiHooked = true;
  const original = proto.createLoadMessage;
  proto.createLoadMessage = function (this: EditorUiHandle, ...args: unknown[]) {
    capturedUi = this;
    return original.apply(this, args);
  };
}

function loadIframeScript(win: DrawioWin, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = win.document;
    const existing = doc.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = doc.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load ${src} in the draw.io first-paint iframe`));
    doc.head.appendChild(script);
  });
}

function ensureMermaidLibs(win: DrawioWin): Promise<void> {
  if (win.mermaid && win.mxMermaidToDrawio) return Promise.resolve();
  if (!mermaidLibs) {
    mermaidLibs = loadIframeScript(win, "js/extensions.min.js").then(() => {
      if (!win.mermaid || !win.mxMermaidToDrawio) {
        throw new Error("draw.io mermaid converter did not initialize");
      }
    });
  }
  return mermaidLibs;
}

function waitForLoadEvent(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = (event: MessageEvent) => {
      if (!iframe || event.source !== iframe.contentWindow) return;
      const msg = parseMessage(event.data);
      if (msg?.event !== "load") return;
      window.removeEventListener("message", onLoad);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onLoad);
      reject(new Error("draw.io first-paint load timed out"));
    }, timeoutMs);
    window.addEventListener("message", onLoad);
  });
}

async function ensureEditorUi(win: DrawioWin): Promise<EditorUiHandle> {
  hookEditorUi(win);
  if (capturedUi) return capturedUi;
  const loaded = waitForLoadEvent(15000);
  post({ action: "load", xml: EMPTY_DRAWIO_XML, autosave: 0 });
  await loaded;
  if (!capturedUi) {
    throw new Error("draw.io embed did not expose an editor instance");
  }
  return capturedUi;
}

function isBlankConvertedXml(xml: string, emptyTemplate: string | undefined): boolean {
  const trimmed = xml.trim();
  if (!trimmed) return true;
  if (emptyTemplate && trimmed === emptyTemplate.trim()) return true;
  if (/<mxfile[\s>]/i.test(trimmed)) {
    return mxGraphModelIsEmpty(trimmed);
  }
  return mxGraphModelIsEmpty(trimmed);
}

let mermaidConvertGen = 0;

function convertWithMermaidToDrawio(
  win: DrawioWin,
  ui: EditorUiHandle,
  source: string,
): Promise<string> {
  const converter = win.mxMermaidToDrawio;
  if (!converter) {
    return Promise.reject(new Error("mxMermaidToDrawio is not loaded"));
  }
  const emptyTemplate = win.EditorUi?.prototype.emptyDiagramXml;
  const gen = ++mermaidConvertGen;
  try {
    converter.resetListeners();
  } catch {
    // ignore
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (xml: string | null, err?: Error) => {
      if (settled || gen !== mermaidConvertGen) return;
      settled = true;
      try {
        converter.resetListeners();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else if (xml) resolve(xml);
      else reject(new Error(EMPTY_PAINT_ERROR));
    };

    converter.htmlLabels = classifyMermaid(source) !== "fixed";
    converter.addListener((modelXml) => {
      if (settled) return;
      if (isBlankConvertedXml(modelXml, emptyTemplate)) return;
      finish(modelXml);
    });

    ui.generateMermaidImage(
      source,
      mermaidRenderConfig(classifyMermaid(source)),
      (imageData, w, h) => {
        window.setTimeout(() => {
          if (settled) return;
          if (typeof ui.createMermaidXml === "function" && imageData) {
            try {
              finish(ui.createMermaidXml(source, null, imageData, w, h));
            } catch (e) {
              finish(null, e instanceof Error ? e : new Error(String(e)));
            }
            return;
          }
          finish(null, new Error(EMPTY_PAINT_ERROR));
        }, 50);
      },
      (e) => {
        finish(null, e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function mermaidToMxfile(win: DrawioWin, mermaid: string): Promise<string> {
  const source = prepareMermaidSource(mermaid);
  const [, ui] = await Promise.all([ensureMermaidLibs(win), ensureEditorUi(win)]);
  const converted = await convertWithMermaidToDrawio(win, ui, source);
  const mxfile = wrapContentAsMxfile(converted);
  await assertPaintedMxfile(mxfile);
  return mxfile;
}

function waitForExport(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const onExport = (event: MessageEvent) => {
      if (!iframe || event.source !== iframe.contentWindow) return;
      const msg = parseMessage(event.data);
      if (msg?.event !== "export") return;
      window.removeEventListener("message", onExport);
      window.clearTimeout(timer);
      const xml =
        (typeof msg.xml === "string" && msg.xml) ||
        (typeof msg.data === "string" && msg.data) ||
        "";
      if (!xml.trim()) reject(new Error("Empty draw.io XML export"));
      else resolve(xml);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onExport);
      reject(new Error("draw.io XML export timed out"));
    }, timeoutMs);
    window.addEventListener("message", onExport);
  });
}

async function xmlToMxfile(win: DrawioWin, xml: string): Promise<string> {
  hookEditorUi(win);
  const wrapped = wrapContentAsMxfile(xml);
  const exported = waitForExport(20000);
  const loaded = waitForLoadEvent(15000);
  post({
    action: "load",
    xml: wrapped,
    layout: elkLayeredLayout("DOWN"),
  });
  await loaded;
  post({ action: "export", format: "xml" });
  const out = wrapContentAsMxfile(await exported);
  await assertPaintedMxfile(out);
  return out;
}

export async function assertPaintedMxfile(mxfile: string): Promise<string> {
  if (await mxfilePageIsEmpty(mxfile, "0")) {
    throw new Error(EMPTY_PAINT_ERROR);
  }
  return mxfile;
}

/** Sequence/gantt/etc. already have dedicated layouts — extra ELK wrecks them. */
const FIXED_LAYOUT_START =
  /^(sequenceDiagram|gantt|sankey|mindmap|timeline|gitGraph|journey|pie|quadrantChart|packet-beta|packet|radar|treemap|kanban|xychart|requirementDiagram|block-beta|block)\b/i;

const FLOW_START =
  /^(flowchart|graph|classDiagram|erDiagram|stateDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/i;

export function classifyMermaid(source: string): MermaidLayoutKind {
  const first = mermaidBodyStart(source).split(/\n/)[0]?.trim() ?? "";
  if (FIXED_LAYOUT_START.test(first)) return "fixed";
  if (FLOW_START.test(first)) return "flow";
  return "other";
}

export function mermaidFlowDirection(source: string): "DOWN" | "RIGHT" {
  const head = source.slice(0, 400);
  if (/\b(LR|RL)\b/.test(head)) return "RIGHT";
  return "DOWN";
}

export function elkLayeredLayout(direction: "DOWN" | "RIGHT") {
  return [
    {
      layout: "elkLayered",
      config: {
        "elk.direction": direction,
        "elk.spacing.nodeNode": 48,
        "elk.layered.spacing.nodeNodeBetweenLayers": 56,
        "elk.padding": "[top=24,left=24,bottom=24,right=24]",
        edgeStyle: "orthogonalEdgeStyle",
        mermaidPolicy: true,
      },
    },
  ];
}

/** Tight sequence columns: wrap at actor width, not a 50px label box. */
export const SEQUENCE_WRAP_CONFIG = {
  wrap: true,
  wrapPadding: 10,
  width: 240,
  actorMargin: 50,
  messageMargin: 52,
  diagramMarginX: 20,
  diagramMarginY: 10,
  boxMargin: 10,
  labelBoxWidth: 240,
  labelBoxHeight: 20,
  mirrorActors: false,
  useMaxWidth: false,
  rightAngles: false,
  showSequenceNumbers: false,
};

function mermaidBodyStart(source: string): string {
  return source
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^%%\{[\s\S]*?\}%%\s*/g, "")
    .trim();
}

function injectFlowElk(source: string): string {
  if (/defaultRenderer\s*:\s*["']elk["']/.test(source) || /layout\s*:\s*["']elk["']/.test(source)) {
    return source;
  }
  return `%%{init: {"flowchart": {"defaultRenderer": "elk", "htmlLabels": true, "nodeSpacing": 50, "rankSpacing": 60, "padding": 16}, "theme": "neutral"}}%%\n${source}`;
}

function injectSequenceWrap(source: string): string {
  if (/["']wrap["']\s*:\s*true/.test(source.slice(0, 500))) return source;
  return `%%{init: {"theme": "neutral", "sequence": ${JSON.stringify(SEQUENCE_WRAP_CONFIG)}}}%%\n${source}`;
}

export function mermaidRenderConfig(kind: MermaidLayoutKind): Record<string, unknown> {
  return {
    theme: "neutral",
    arrowMarkerAbsolute: false,
    flowchart: {
      htmlLabels: true,
      ...(kind === "flow"
        ? { defaultRenderer: "elk", nodeSpacing: 50, rankSpacing: 60, padding: 16 }
        : {}),
    },
    sequence: SEQUENCE_WRAP_CONFIG,
  };
}

export function prepareMermaidSource(mermaid: string): string {
  const kind = classifyMermaid(mermaid);
  if (kind === "flow") return injectFlowElk(mermaid);
  if (kind === "fixed" && /^sequenceDiagram\b/i.test(mermaidBodyStart(mermaid))) {
    return injectSequenceWrap(mermaid);
  }
  return mermaid;
}

/** Official embed protocol (draw.io ≥ 29.3). Bundled v28.2.5 ignores this. */
export function mermaidLoadAction(mermaid: string): Record<string, unknown> {
  const kind = classifyMermaid(mermaid);
  const data = prepareMermaidSource(mermaid);
  const action: Record<string, unknown> = {
    action: "load",
    descriptor: {
      format: "mermaid",
      data,
      wrap: false,
    },
  };
  if (kind === "flow") {
    action.layout = elkLayeredLayout(mermaidFlowDirection(mermaid));
  }
  return action;
}

export function xmlLoadAction(xml: string): Record<string, unknown> {
  return {
    action: "load",
    xml,
    layout: elkLayeredLayout("DOWN"),
  };
}

function finishError(err: Error) {
  if (!active) return;
  window.clearTimeout(active.timer);
  const pending = active;
  active = null;
  pending.reject(err);
  pump();
}

function onMessage(event: MessageEvent) {
  if (!iframe || event.source !== iframe.contentWindow) return;
  const msg = parseMessage(event.data);
  if (!msg) return;

  if (msg.event === "init") {
    const win = drawioWindow();
    if (win) {
      hookEditorUi(win);
      void ensureMermaidLibs(win).catch(() => {
        mermaidLibs = null;
      });
    }
    ready = true;
    pump();
    return;
  }

  if (msg.event === "error" && active) {
    const text =
      typeof msg.message === "string"
        ? msg.message
        : "draw.io rejected the diagram";
    finishError(new Error(text));
  }
}

function pump() {
  if (!ready || active || queue.length === 0) return;
  const next = queue.shift()!;
  active = next;
  const win = drawioWindow();
  if (!win) {
    active = null;
    next.reject(new Error("draw.io first-paint iframe has no window"));
    pump();
    return;
  }
  next.timer = window.setTimeout(() => {
    if (active !== next) return;
    active = null;
    next.reject(new Error("draw.io first-paint import timed out"));
    pump();
  }, 40000);

  void next
    .run(win)
    .then((xml) => {
      if (active !== next) return;
      window.clearTimeout(next.timer);
      active = null;
      next.resolve(xml);
      pump();
    })
    .catch((e) => {
      if (active !== next) return;
      window.clearTimeout(next.timer);
      active = null;
      next.reject(e instanceof Error ? e : new Error(String(e)));
      pump();
    });
}

function enqueue(run: (win: DrawioWin) => Promise<string>): Promise<string> {
  if (typeof document === "undefined") {
    return Promise.reject(
      new Error("Draw.io first paint requires the editor (browser)"),
    );
  }
  ensureIframe();
  return new Promise<string>((resolve, reject) => {
    queue.push({ run, resolve, reject, timer: 0 });
    if (ready) pump();
  });
}

/**
 * Convert Mermaid source to a vault mxfile via bundled draw.io.
 * v28.2.5 has no mermaid `descriptor` in embed load — we drive
 * generateMermaidImage + mxMermaidToDrawio instead.
 */
export function convertMermaidToMxfile(mermaid: string): Promise<string> {
  const source = mermaid.trim();
  if (!source) return Promise.reject(new Error("mermaid content is empty"));
  return enqueue((win) => mermaidToMxfile(win, source));
}

/** Wrap XML and run ELK layered layout in the bundled editor. */
export function convertXmlToMxfile(xml: string): Promise<string> {
  return enqueue((win) => xmlToMxfile(win, xml));
}

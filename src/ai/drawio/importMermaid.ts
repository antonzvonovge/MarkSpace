import { buildDrawioEmbedUrl } from "../../editor/drawio/constants";
import { wrapContentAsMxfile } from "./pages";

type PendingConvert = {
  mermaid: string;
  resolve: (xml: string) => void;
  reject: (err: Error) => void;
  timer: number;
};

let iframe: HTMLIFrameElement | null = null;
let ready = false;
let queue: PendingConvert[] = [];
let active: PendingConvert | null = null;
let waitingForLoad = false;

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;
  const el = document.createElement("iframe");
  el.title = "drawio-mermaid-import";
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;width:1px;height:1px;left:-100px;top:-100px;opacity:0;pointer-events:none;border:0";
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

export function mermaidLoadAction(mermaid: string): Record<string, unknown> {
  return {
    action: "load",
    descriptor: {
      format: "mermaid",
      data: mermaid,
      wrap: false,
    },
  };
}

function finishError(err: Error) {
  if (!active) return;
  window.clearTimeout(active.timer);
  const pending = active;
  active = null;
  waitingForLoad = false;
  pending.reject(err);
  pump();
}

function onMessage(event: MessageEvent) {
  if (!iframe || event.source !== iframe.contentWindow) return;
  const msg = parseMessage(event.data);
  if (!msg) return;

  if (msg.event === "init") {
    ready = true;
    pump();
    return;
  }

  if (msg.event === "load" && waitingForLoad && active) {
    waitingForLoad = false;
    post({ action: "export", format: "xml" });
    return;
  }

  if (msg.event === "export" && active) {
    const xml =
      (typeof msg.xml === "string" && msg.xml) ||
      (typeof msg.data === "string" && msg.data) ||
      "";
    window.clearTimeout(active.timer);
    const pending = active;
    active = null;
    waitingForLoad = false;
    if (!xml.trim()) {
      pending.reject(new Error("Empty draw.io XML export from Mermaid"));
    } else {
      try {
        pending.resolve(wrapContentAsMxfile(xml));
      } catch (e) {
        pending.reject(e instanceof Error ? e : new Error(String(e)));
      }
    }
    pump();
    return;
  }

  if (msg.event === "error" && active) {
    const text =
      typeof msg.message === "string"
        ? msg.message
        : "draw.io rejected the Mermaid diagram";
    finishError(new Error(text));
  }
}

function pump() {
  if (!ready || active || queue.length === 0) return;
  const next = queue.shift()!;
  active = next;
  waitingForLoad = true;
  next.timer = window.setTimeout(() => {
    if (active !== next) return;
    active = null;
    waitingForLoad = false;
    next.reject(new Error("draw.io Mermaid import timed out"));
    pump();
  }, 25000);

  post(mermaidLoadAction(next.mermaid));
}

/**
 * Convert Mermaid source to a vault mxfile via the bundled draw.io embed.
 */
export function convertMermaidToMxfile(mermaid: string): Promise<string> {
  const source = mermaid.trim();
  if (!source) return Promise.reject(new Error("mermaid content is empty"));
  if (typeof document === "undefined") {
    return Promise.reject(
      new Error("Mermaid import requires the Draw.io editor (browser)"),
    );
  }
  ensureIframe();
  return new Promise<string>((resolve, reject) => {
    queue.push({ mermaid: source, resolve, reject, timer: 0 });
    if (ready) pump();
  });
}

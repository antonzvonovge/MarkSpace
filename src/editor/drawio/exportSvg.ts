import { buildDrawioEmbedUrl } from "./constants";

type PendingExport = {
  xml: string;
  resolve: (svg: string) => void;
  reject: (err: Error) => void;
  timer: number;
};

let iframe: HTMLIFrameElement | null = null;
let ready = false;
let queue: PendingExport[] = [];
let active: PendingExport | null = null;
let waitingForLoad = false;

function ensureIframe(): HTMLIFrameElement {
  if (iframe) return iframe;
  const el = document.createElement("iframe");
  el.title = "drawio-export";
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;width:1px;height:1px;left:-100px;top:-100px;opacity:0;pointer-events:none;border:0";
  // Full embed editor (not lightbox) — export protocol is more reliable here.
  el.src = buildDrawioEmbedUrl({});
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
    post({
      action: "export",
      format: "svg",
      xml: active.xml,
      embedImages: 0,
    });
    return;
  }

  if (msg.event === "export" && active) {
    const data = typeof msg.data === "string" ? msg.data : "";
    window.clearTimeout(active.timer);
    const pending = active;
    active = null;
    waitingForLoad = false;
    if (data) pending.resolve(data);
    else pending.reject(new Error("Empty draw.io SVG export"));
    pump();
  }
}

function post(action: Record<string, unknown>) {
  iframe?.contentWindow?.postMessage(JSON.stringify(action), "*");
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
    next.reject(new Error("draw.io SVG export timed out"));
    pump();
  }, 25000);

  // Do not pass spin:false — draw.io treats non-null spin as status text.
  post({
    action: "load",
    xml: next.xml,
    autosave: 0,
  });
}

/** Normalize draw.io export payload (raw SVG or data URI) for DOM injection. */
export function normalizeExportedSvg(data: string): string {
  const trimmed = data.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("data:image/svg+xml")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0) return "";
    const meta = trimmed.slice(0, comma);
    const payload = trimmed.slice(comma + 1);
    try {
      const decoded = /;base64/i.test(meta)
        ? atob(payload)
        : decodeURIComponent(payload.replace(/\+/g, " "));
      return stripSvgWrapperNoise(decoded);
    } catch {
      return "";
    }
  }

  return stripSvgWrapperNoise(trimmed);
}

function stripSvgWrapperNoise(svg: string): string {
  let out = svg.trim();
  // Drop XML declaration / doctype if present
  out = out.replace(/^<\?xml[\s\S]*?\?>\s*/i, "");
  out = out.replace(/^<!DOCTYPE[\s\S]*?>\s*/i, "");
  // Ensure the root svg scales in the note
  if (/<svg\b/i.test(out) && !/\sstyle=/i.test(out.slice(0, 200))) {
    out = out.replace(
      /<svg\b([^>]*)>/i,
      (_m, attrs: string) =>
        `<svg${attrs} style="max-width:100%;height:auto;display:block">`,
    );
  }
  return out;
}

/** Export diagram XML to SVG via a shared offline draw.io iframe. */
export function exportDrawioXmlToSvg(xml: string): Promise<string> {
  ensureIframe();
  return new Promise<string>((resolve, reject) => {
    queue.push({ xml, resolve, reject, timer: 0 });
    if (ready) pump();
  });
}

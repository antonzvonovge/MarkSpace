import { useEffect, useRef } from "react";
import { usePrefsStore } from "../../store/prefsStore";
import { buildDrawioEmbedUrl } from "./constants";
import { exportDrawioXmlToSvg } from "./exportSvg";
import { applyDrawioIframeTweaks } from "./iframeTweaks";
import { drawioPreviewCacheKey, putDrawioSvg } from "./previewCache";

type Props = {
  path: string;
  content: string;
  onChange: (xml: string) => void;
};

function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function DrawioEditor({ path, content, onChange }: Props) {
  const theme = usePrefsStore((s) => s.prefs.theme);
  const dark = theme === "dark";
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pathRef = useRef(path);
  pathRef.current = path;
  const lastLoadedRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  const previewTimerRef = useRef<number | null>(null);

  const src = buildDrawioEmbedUrl({ dark });

  useEffect(() => {
    readyRef.current = false;
    lastLoadedRef.current = null;
  }, [src, path]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const msg = parseMessage(event.data);
      if (!msg) return;

      const post = (action: Record<string, unknown>) => {
        frame.contentWindow?.postMessage(JSON.stringify(action), "*");
      };

      if (msg.event === "init") {
        readyRef.current = true;
        skipNextAutosaveRef.current = true;
        lastLoadedRef.current = contentRef.current;
        applyDrawioIframeTweaks(iframeRef.current);
        post({
          action: "load",
          xml: contentRef.current || "",
          autosave: 1,
          title: pathRef.current.split("/").pop() || "diagram.drawio",
        });
        // mxKeyHandler may be created slightly after init.
        window.setTimeout(() => applyDrawioIframeTweaks(iframeRef.current), 0);
        window.setTimeout(() => applyDrawioIframeTweaks(iframeRef.current), 250);
        return;
      }

      if (msg.event === "load") {
        skipNextAutosaveRef.current = false;
        applyDrawioIframeTweaks(iframeRef.current);
        return;
      }

      if (msg.event === "autosave" || msg.event === "save") {
        if (skipNextAutosaveRef.current) return;
        const xml = typeof msg.xml === "string" ? msg.xml : "";
        if (!xml || xml === contentRef.current) return;
        lastLoadedRef.current = xml;
        onChangeRef.current(xml);
        // Preview SVG via a separate iframe — never send export with spin:false
        // to the editor (draw.io treats non-null spin as status text → crash).
        if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = window.setTimeout(() => {
          const key = drawioPreviewCacheKey(pathRef.current, xml);
          void exportDrawioXmlToSvg(xml)
            .then((svg) => putDrawioSvg(key, svg))
            .catch(() => {
              /* preview cache is best-effort */
            });
        }, 600);
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!readyRef.current) return;
    if (content === lastLoadedRef.current) return;
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    skipNextAutosaveRef.current = true;
    lastLoadedRef.current = content;
    frame.contentWindow.postMessage(
      JSON.stringify({
        action: "load",
        xml: content || "",
        autosave: 1,
        title: path.split("/").pop() || "diagram.drawio",
      }),
      "*",
    );
  }, [content, path]);

  return (
    <div className="drawio-editor">
      <iframe
        key={`${path}:${src}`}
        ref={iframeRef}
        className="drawio-editor__frame"
        title={`Draw.io — ${path}`}
        src={src}
        allow="clipboard-read; clipboard-write"
        onLoad={() => applyDrawioIframeTweaks(iframeRef.current)}
      />
    </div>
  );
}

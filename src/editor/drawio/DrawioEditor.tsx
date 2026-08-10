import { useCallback, useEffect, useRef } from "react";
import { usePrefsStore } from "../../store/prefsStore";
import { useVaultStore } from "../../store/vaultStore";
import { buildDrawioEmbedUrl } from "./constants";
import { registerDrawioEditorFlush } from "./drawioEditorFlush";
import { applyDrawioIframeTweaks } from "./iframeTweaks";
import { warmDrawioPreview } from "./warmPreview";

type Props = {
  path: string;
  content: string;
  onChange: (xml: string) => void;
  /** False for keep-alive hidden tabs — ignore iframe messages. */
  isActive?: boolean;
};

/** Debounce Zustand updates so drag/edit does not thrash React with full XML. */
const STORE_DEBOUNCE_MS = 1800;

function parseMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function DrawioEditor({
  path,
  content,
  onChange,
  isActive = true,
}: Props) {
  const theme = usePrefsStore((s) => s.prefs.theme);
  const dark = theme === "dark";
  const markDirty = useVaultStore((s) => s.markDirty);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pathRef = useRef(path);
  pathRef.current = path;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const lastLoadedRef = useRef<string | null>(null);
  const skipNextAutosaveRef = useRef(false);
  /** Latest XML from iframe; may be ahead of the vault store. */
  const pendingXmlRef = useRef<string | null>(null);
  const lastEmittedRef = useRef<string | null>(content);
  const storeTimerRef = useRef<number | null>(null);
  const pendingStoreRef = useRef(false);
  const wasActiveRef = useRef(isActive);

  const src = buildDrawioEmbedUrl({ dark });

  const flushToStore = useCallback(() => {
    if (storeTimerRef.current != null) {
      window.clearTimeout(storeTimerRef.current);
      storeTimerRef.current = null;
    }
    if (!pendingStoreRef.current) return;
    pendingStoreRef.current = false;
    const xml = pendingXmlRef.current;
    if (xml == null || xml === lastEmittedRef.current) return;
    lastEmittedRef.current = xml;
    lastLoadedRef.current = xml;
    onChangeRef.current(xml);
  }, []);

  const scheduleStoreFlush = useCallback(() => {
    pendingStoreRef.current = true;
    if (storeTimerRef.current != null) {
      window.clearTimeout(storeTimerRef.current);
    }
    storeTimerRef.current = window.setTimeout(() => {
      storeTimerRef.current = null;
      flushToStore();
    }, STORE_DEBOUNCE_MS);
  }, [flushToStore]);

  useEffect(() => registerDrawioEditorFlush(path, flushToStore), [
    path,
    flushToStore,
  ]);

  useEffect(() => {
    readyRef.current = false;
    lastLoadedRef.current = null;
    pendingXmlRef.current = null;
    lastEmittedRef.current = contentRef.current;
    pendingStoreRef.current = false;
    if (storeTimerRef.current != null) {
      window.clearTimeout(storeTimerRef.current);
      storeTimerRef.current = null;
    }
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
        lastEmittedRef.current = contentRef.current;
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
        // Hidden keep-alive tabs must not steal writes from the active note.
        if (!isActiveRef.current) return;
        if (skipNextAutosaveRef.current) return;
        const xml = typeof msg.xml === "string" ? msg.xml : "";
        if (!xml || xml === pendingXmlRef.current) return;
        if (xml === lastEmittedRef.current && !pendingStoreRef.current) return;
        pendingXmlRef.current = xml;
        // Dirty immediately; full XML hits Zustand on debounce / flush.
        markDirty();
        scheduleStoreFlush();
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (storeTimerRef.current != null) {
        window.clearTimeout(storeTimerRef.current);
        storeTimerRef.current = null;
      }
      if (pendingStoreRef.current) {
        pendingStoreRef.current = false;
        const xml = pendingXmlRef.current;
        if (xml != null && xml !== lastEmittedRef.current) {
          lastEmittedRef.current = xml;
          onChangeRef.current(xml);
        }
      }
    };
  }, [markDirty, scheduleStoreFlush]);

  // Leave tab / blur: flush store + warm embed preview (not on every edit).
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (wasActive && !isActive) {
      flushToStore();
      const xml = pendingXmlRef.current ?? contentRef.current;
      if (xml) warmDrawioPreview(path, xml);
    }
  }, [isActive, path, flushToStore]);

  useEffect(() => {
    if (!isActive) return;
    if (!readyRef.current) return;
    if (content === lastLoadedRef.current) return;
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    skipNextAutosaveRef.current = true;
    lastLoadedRef.current = content;
    lastEmittedRef.current = content;
    pendingXmlRef.current = content;
    pendingStoreRef.current = false;
    if (storeTimerRef.current != null) {
      window.clearTimeout(storeTimerRef.current);
      storeTimerRef.current = null;
    }
    frame.contentWindow.postMessage(
      JSON.stringify({
        action: "load",
        xml: content || "",
        autosave: 1,
        title: path.split("/").pop() || "diagram.drawio",
      }),
      "*",
    );
  }, [content, path, isActive]);

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

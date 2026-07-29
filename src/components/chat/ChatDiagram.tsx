import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { DiagramEngine } from "../../editor/diagramCache";
import { renderMermaidToSvg } from "../../editor/mermaid/renderMermaid";
import { renderPlantUmlToSvg } from "../../editor/plantuml/renderPlantUml";
import { scheduleDiagramPreview } from "../../editor/scheduleDiagramPreview";
import { usePrefsStore } from "../../store/prefsStore";

const DIAGRAM_LANGS: Record<string, DiagramEngine> = {
  mermaid: "mermaid",
  plantuml: "plantuml",
  puml: "plantuml",
};

export function diagramEngineForLang(
  lang: string | undefined,
): DiagramEngine | null {
  if (!lang) return null;
  return DIAGRAM_LANGS[lang.toLowerCase()] ?? null;
}

/**
 * Keep intrinsic SVG size (no stretch-to-column). Only shrink if wider than
 * the chat column. Stretching width=100% was the "gigantism" bug.
 */
function fitSvgInto(
  container: HTMLElement,
  svgMarkup: string | null,
  opts?: { constrainToWidth?: boolean; zoom?: number },
) {
  container.innerHTML = svgMarkup ?? "";
  const svg = container.querySelector("svg");
  if (!svg) return;

  let vbW = 0;
  let vbH = 0;
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      vbW = parts[2];
      vbH = parts[3];
    }
  }
  if (!vbW || !vbH) {
    const width = parseFloat(svg.getAttribute("width") || "");
    const height = parseFloat(svg.getAttribute("height") || "");
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      vbW = width;
      vbH = height;
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    }
  }

  const zoom = opts?.zoom ?? 1;
  const constrain = opts?.constrainToWidth ?? true;

  if (vbW > 0 && vbH > 0) {
    svg.dataset.baseW = String(vbW);
    svg.dataset.baseH = String(vbH);
    svg.setAttribute("width", String(vbW * zoom));
    svg.setAttribute("height", String(vbH * zoom));
    svg.style.width = `${vbW * zoom}px`;
    svg.style.height = `${vbH * zoom}px`;
  } else {
    svg.removeAttribute("width");
    svg.removeAttribute("height");
  }

  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.display = "block";
  svg.style.marginInline = "auto";
  svg.style.maxWidth = constrain && zoom <= 1 ? "100%" : "none";
}

function applySvgZoom(container: HTMLElement, zoom: number) {
  const svg = container.querySelector("svg");
  if (!svg) return;
  const baseW = Number(svg.dataset.baseW);
  const baseH = Number(svg.dataset.baseH);
  if (!baseW || !baseH) return;
  svg.setAttribute("width", String(baseW * zoom));
  svg.setAttribute("height", String(baseH * zoom));
  svg.style.width = `${baseW * zoom}px`;
  svg.style.height = `${baseH * zoom}px`;
  svg.style.maxWidth = "none";
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function clampZoom(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

type Props = {
  engine: DiagramEngine;
  code: string;
};

function ChatDiagramLightbox({
  open,
  engine,
  code,
  onClose,
}: {
  open: boolean;
  engine: DiagramEngine;
  code: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [svgReady, setSvgReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const copiedTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== undefined) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const copyMarkup = useCallback(async () => {
    const text = code.trim();
    if (!text) return;
    try {
      await writeText(text);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    if (copiedTimerRef.current !== undefined) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [code]);

  useEffect(() => {
    if (!open) {
      setZoom(1);
      setSvgReady(false);
      setCopied(false);
      return;
    }
    // Lightbox always light + neutral on white, independent of app theme.
    return scheduleDiagramPreview({
      engine,
      code,
      dark: false,
      skin: "neutral",
      render: engine === "mermaid" ? renderMermaidToSvg : renderPlantUmlToSvg,
      onUpdate: ({ svg, error: nextError, pending: nextPending }) => {
        setError(nextError);
        setPending(nextPending);
        if (containerRef.current) {
          fitSvgInto(containerRef.current, svg, {
            constrainToWidth: false,
            zoom: zoomRef.current,
          });
          setSvgReady(Boolean(svg) && !nextError);
        }
      },
    });
  }, [open, engine, code]);

  useEffect(() => {
    if (!open || !svgReady || !containerRef.current) return;
    applySvgZoom(containerRef.current, zoom);
  }, [open, svgReady, zoom]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => clampZoom(z + ZOOM_STEP));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => clampZoom(z - ZOOM_STEP));
        return;
      }
      if (e.key === "0" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setZoom(1);
      }
    };
    document.addEventListener("keydown", onKey);
    const id = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      window.cancelAnimationFrame(id);
    };
  }, [open, onClose]);

  const onWheel = (e: ReactWheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    setZoom((z) => clampZoom(z + direction * ZOOM_STEP));
  };

  if (!open) return null;

  const zoomPercent = `${Math.round(zoom * 100)}%`;

  return createPortal(
    <div className="chat-diagram-lightbox-root" role="presentation">
      <button
        type="button"
        className="chat-diagram-lightbox-backdrop"
        aria-label="Close diagram"
        onClick={onClose}
      />
      <div
        className="chat-diagram-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="chat-diagram-lightbox__header">
          <h2 id={titleId} className="chat-diagram-lightbox__title">
            Diagram
          </h2>
          <div className="chat-diagram-lightbox__actions">
            <div
              className="chat-diagram-lightbox__zoom"
              role="group"
              aria-label="Zoom"
            >
              <button
                type="button"
                className="app-dialog-btn chat-diagram-lightbox__zoom-btn"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              >
                −
              </button>
              <button
                type="button"
                className="app-dialog-btn chat-diagram-lightbox__zoom-label"
                aria-label={`Reset zoom (${zoomPercent})`}
                title="Reset zoom"
                onClick={() => setZoom(1)}
              >
                {zoomPercent}
              </button>
              <button
                type="button"
                className="app-dialog-btn chat-diagram-lightbox__zoom-btn"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={
                copied
                  ? "chat-diagram-lightbox__icon-btn is-copied"
                  : "chat-diagram-lightbox__icon-btn"
              }
              aria-label={copied ? "Copied" : "Copy diagram markup"}
              title={copied ? "Copied" : "Copy markup"}
              disabled={!code.trim()}
              onClick={() => void copyMarkup()}
            >
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.5 11.2L3.3 8l1.06-1.06L6.5 9.08l5.14-5.14L12.7 5 6.5 11.2z"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M5.5 2A1.5 1.5 0 004 3.5V4h-.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h6a1.5 1.5 0 001.5-1.5V12h.5A1.5 1.5 0 0013 10.5v-7A1.5 1.5 0 0011.5 2h-6zM5 3.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H11V5.5A1.5 1.5 0 009.5 4H5v-.5zM3.5 5H9.5a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5z"
                  />
                </svg>
              )}
            </button>
            <button
              ref={closeRef}
              type="button"
              className="app-dialog-btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </header>
        <div className="chat-diagram-lightbox__body" onWheel={onWheel}>
          {pending ? (
            <div className="chat-md-diagram__pending">Rendering…</div>
          ) : null}
          {error ? (
            <div className="chat-md-diagram__error">{error}</div>
          ) : null}
          <div
            ref={containerRef}
            className="chat-diagram-lightbox__svg"
            hidden={Boolean(error)}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ChatDiagram({ engine, code }: Props) {
  const theme = usePrefsStore((s) => s.prefs.theme);
  const dark = theme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return scheduleDiagramPreview({
      engine,
      code,
      dark,
      skin: "neutral",
      render: engine === "mermaid" ? renderMermaidToSvg : renderPlantUmlToSvg,
      onUpdate: ({ svg, error: nextError, pending: nextPending }) => {
        setError(nextError);
        setPending(nextPending);
        if (containerRef.current) {
          fitSvgInto(containerRef.current, svg);
        }
      },
    });
  }, [engine, code, dark]);

  const openLightbox = useCallback(() => {
    if (!code.trim() || error) return;
    setOpen(true);
  }, [code, error]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openLightbox();
    }
  };

  const onClick = (e: ReactMouseEvent) => {
    e.preventDefault();
    openLightbox();
  };

  if (!code.trim()) {
    return (
      <div className="chat-md-diagram">
        <div className="chat-md-diagram__empty">Empty diagram</div>
      </div>
    );
  }

  return (
    <>
      <div
        className="chat-md-diagram is-interactive"
        data-engine={engine}
        role="button"
        tabIndex={0}
        aria-label="Open diagram fullscreen"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        {pending ? (
          <div className="chat-md-diagram__pending">Rendering…</div>
        ) : null}
        {error ? <div className="chat-md-diagram__error">{error}</div> : null}
        <div
          ref={containerRef}
          className="chat-md-diagram__svg"
          hidden={Boolean(error)}
        />
      </div>
      <ChatDiagramLightbox
        open={open}
        engine={engine}
        code={code}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createPortal } from "react-dom";
import type { DiagramEngine } from "../editor/diagramCache";
import { diagramRenderFn } from "../editor/renderDiagram";
import { scheduleDiagramPreview } from "../editor/scheduleDiagramPreview";

/**
 * Keep intrinsic SVG size (no stretch-to-column). Only shrink if wider than
 * the container when zoom ≤ 1.
 */
export function fitSvgInto(
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

const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_MAX;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < current) ?? ZOOM_LEVELS[0];
}

type Props = {
  open: boolean;
  engine: DiagramEngine;
  code: string;
  onClose: () => void;
  title?: string;
};

/** Full-window viewer (same shell as ImageLightbox): white canvas, zoom + pan. */
export function DiagramLightbox({
  open,
  engine,
  code,
  onClose,
  title = "Diagram",
}: Props) {
  const titleId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [svgReady, setSvgReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panning, setPanning] = useState(false);
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
      setPanning(false);
      return;
    }
    // Lightbox always light + neutral on white, independent of app theme.
    return scheduleDiagramPreview({
      engine,
      code,
      dark: false,
      skin: "neutral",
      render: diagramRenderFn(engine),
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
        setZoom((z) => nextZoom(z, 1));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => nextZoom(z, -1));
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

  const changeZoom = useCallback((next: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      setZoom(next);
      return;
    }
    const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
    const centerY = viewport.scrollTop + viewport.clientHeight / 2;
    setZoom((current) => {
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = (centerX * next) / current - viewport.clientWidth / 2;
        viewport.scrollTop = (centerY * next) / current - viewport.clientHeight / 2;
      });
      return next;
    });
  }, []);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    changeZoom(nextZoom(zoom, e.deltaY < 0 ? 1 : -1));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const viewport = event.currentTarget;
    event.preventDefault();
    viewport.setPointerCapture(event.pointerId);
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    setPanning(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panning) return;
    const start = panRef.current;
    event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
    event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
  };

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPanning(false);
  };

  if (!open) return null;

  const zoomPercent = `${Math.round(zoom * 100)}%`;

  return createPortal(
    <div className="diagram-lightbox-root" role="presentation">
      <div
        className="diagram-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="diagram-lightbox__header">
          <h2 id={titleId} className="diagram-lightbox__title">
            {title}
          </h2>
          <div className="diagram-lightbox__actions">
            <div
              className="diagram-lightbox__zoom"
              role="group"
              aria-label="Zoom"
            >
              <button
                type="button"
                className="diagram-lightbox__btn diagram-lightbox__zoom-btn"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_LEVELS[0]}
                onClick={() => changeZoom(nextZoom(zoom, -1))}
              >
                −
              </button>
              <button
                type="button"
                className="diagram-lightbox__btn diagram-lightbox__zoom-label"
                aria-label={`Reset zoom (${zoomPercent})`}
                title="Show original size"
                onClick={() => changeZoom(1)}
              >
                {zoomPercent}
              </button>
              <button
                type="button"
                className="diagram-lightbox__btn diagram-lightbox__zoom-btn"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => changeZoom(nextZoom(zoom, 1))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={
                copied
                  ? "diagram-lightbox__btn diagram-lightbox__icon-btn is-copied"
                  : "diagram-lightbox__btn diagram-lightbox__icon-btn"
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
              className="diagram-lightbox__btn diagram-lightbox__close"
              aria-label="Close"
              title="Close (Esc)"
              onClick={onClose}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  d="M4 4l8 8M12 4l-8 8"
                />
              </svg>
            </button>
          </div>
        </header>
        <div
          ref={viewportRef}
          className={
            panning
              ? "diagram-lightbox__viewport is-panning"
              : "diagram-lightbox__viewport"
          }
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopPanning}
          onPointerCancel={stopPanning}
        >
          {pending ? (
            <div className="diagram-lightbox__pending">Rendering…</div>
          ) : null}
          {error ? (
            <div className="diagram-lightbox__error">{error}</div>
          ) : null}
          <div className="diagram-lightbox__stage" hidden={Boolean(error)}>
            <div ref={containerRef} className="diagram-lightbox__svg" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Expand / zoom-in icon for diagram block toolbars. */
export function DiagramExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"
      />
    </svg>
  );
}

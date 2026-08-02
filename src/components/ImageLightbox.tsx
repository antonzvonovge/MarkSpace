import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
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

const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];
const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_LEVELS.find((level) => level > current) ?? ZOOM_MAX;
  }
  return [...ZOOM_LEVELS].reverse().find((level) => level < current) ?? ZOOM_LEVELS[0];
}

type Props = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export function ImageLightbox({ src, alt, onClose }: Props) {
  const titleId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    setZoom(1);
    setSize({ width: 0, height: 0 });
    setCopyState("idle");
  }, [src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((value) => nextZoom(value, 1));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((value) => nextZoom(value, -1));
      } else if (event.key === "0" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setZoom(1);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const focusId = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(focusId);
      if (copiedTimerRef.current !== undefined) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, [onClose]);

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

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(nextZoom(zoom, event.deltaY < 0 ? 1 : -1));
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

  const copyImage = useCallback(async () => {
    const image = imageRef.current;
    if (!image || !image.naturalWidth || !image.naturalHeight) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const clipboardImage = await TauriImage.new(
        pixels.data,
        canvas.width,
        canvas.height,
      );
      try {
        await writeImage(clipboardImage);
      } finally {
        await clipboardImage.close();
      }
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }

    if (copiedTimerRef.current !== undefined) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopyState("idle"), 1800);
  }, []);

  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Could not copy image"
        : "Copy image";

  return createPortal(
    <div className="image-lightbox-root" role="presentation">
      <div
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="image-lightbox__header">
          <h2 id={titleId} className="image-lightbox__title">
            Image
          </h2>
          <div className="image-lightbox__actions">
            <div className="image-lightbox__zoom" role="group" aria-label="Zoom">
              <button
                type="button"
                className="image-lightbox__btn image-lightbox__zoom-btn"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_LEVELS[0]}
                onClick={() => changeZoom(nextZoom(zoom, -1))}
              >
                −
              </button>
              <button
                type="button"
                className="image-lightbox__btn image-lightbox__zoom-label"
                aria-label={`Reset zoom (${zoomPercent})`}
                title="Show original size"
                onClick={() => changeZoom(1)}
              >
                {zoomPercent}
              </button>
              <button
                type="button"
                className="image-lightbox__btn image-lightbox__zoom-btn"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => changeZoom(nextZoom(zoom, 1))}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={`image-lightbox__btn image-lightbox__icon-btn is-${copyState}`}
              aria-label={copyLabel}
              title={copyLabel}
              onClick={() => void copyImage()}
            >
              {copyState === "copied" ? (
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
              className="image-lightbox__btn image-lightbox__close"
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
          className={panning ? "image-lightbox__viewport is-panning" : "image-lightbox__viewport"}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopPanning}
          onPointerCancel={stopPanning}
        >
          <div className="image-lightbox__stage">
            <img
              ref={imageRef}
              src={src}
              alt={alt ?? ""}
              draggable={false}
              width={size.width ? size.width * zoom : undefined}
              height={size.height ? size.height * zoom : undefined}
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

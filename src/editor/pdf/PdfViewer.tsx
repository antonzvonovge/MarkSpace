import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { absolutePath } from "../../lib/vaultApi";
import {
  clampOutlineWidth,
  hasDocOutlineUi,
  loadDocOutlineUi,
  OUTLINE_WIDTH_MAX,
  OUTLINE_WIDTH_MIN,
  saveDocOutlineOpen,
  saveDocOutlineWidth,
} from "../../lib/outlineUiState";
import {
  clampPdfPage,
  clampPdfScale,
  loadDocPdfUi,
  PDF_SCALE_DEFAULT,
  saveDocPdfPage,
  saveDocPdfZoom,
} from "../../lib/pdfUiState";
import { useVaultStore } from "../../store/vaultStore";
import { PdfDocumentTags } from "./PdfDocumentTags";

type OutlineItem = {
  title: string;
  pageNumber: number;
  items?: OutlineItem[];
};

type Props = {
  path: string;
};

const SCALE_STEP = 0.1;
/** Wait for zoom gestures to settle before expensive canvas re-render. */
const RENDER_DEBOUNCE_MS = 180;
const PAGE_SAVE_DEBOUNCE_MS = 250;

type Cancelable = { cancel: () => void };

let pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then(async (pdfjs) => {
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

async function outlineFromPdf(
  doc: PDFDocumentProxy,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any[] | null,
): Promise<OutlineItem[]> {
  if (!raw?.length) return [];
  const out: OutlineItem[] = [];
  for (const item of raw) {
    let pageNumber = 1;
    try {
      if (item.dest) {
        const dest =
          typeof item.dest === "string"
            ? await doc.getDestination(item.dest)
            : item.dest;
        if (Array.isArray(dest) && dest[0]) {
          const idx = await doc.getPageIndex(dest[0]);
          pageNumber = idx + 1;
        }
      }
    } catch {
      // keep default page
    }
    const children = item.items
      ? await outlineFromPdf(doc, item.items)
      : undefined;
    out.push({
      title: String(item.title || "Untitled"),
      pageNumber,
      ...(children?.length ? { items: children } : {}),
    });
  }
  return out;
}

function OutlineTree({
  items,
  activePage,
  onSelect,
  depth = 0,
}: {
  items: OutlineItem[];
  activePage: number;
  onSelect: (page: number) => void;
  depth?: number;
}) {
  return (
    <ul
      className="pdf-viewer__outline-list"
      style={{ paddingLeft: depth ? 12 : 0 }}
    >
      {items.map((item, i) => (
        <li key={`${item.title}-${i}`}>
          <button
            type="button"
            className={
              item.pageNumber === activePage
                ? "pdf-viewer__outline-item is-active"
                : "pdf-viewer__outline-item"
            }
            onClick={() => onSelect(item.pageNumber)}
          >
            {item.title}
          </button>
          {item.items?.length ? (
            <OutlineTree
              items={item.items}
              activePage={activePage}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function PdfViewer({ path }: Props) {
  const takePendingPdfPage = useVaultStore((s) => s.takePendingPdfPage);
  const pendingPdfPage = useVaultStore((s) => s.pendingPdfPage);
  const vaultPath = useVaultStore((s) => s.vaultPath);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderToken = useRef(0);
  const findCursorRef = useRef(0);
  /** Scale at which canvases were last fully rasterized. */
  const renderedScaleRef = useRef(PDF_SCALE_DEFAULT);
  const scaleRef = useRef(PDF_SCALE_DEFAULT);
  const fitWidthRef = useRef(false);
  const pageRef = useRef(1);
  const renderTimerRef = useRef<number | null>(null);
  const pageSaveTimerRef = useRef<number | null>(null);
  const activeTasksRef = useRef<Cancelable[]>([]);
  const restorePageRef = useRef<number | null>(null);

  const initialPdfUi = loadDocPdfUi(vaultPath, path);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(() => initialPdfUi.page);
  const [scale, setScale] = useState(() => initialPdfUi.scale);
  const [fitWidth, setFitWidth] = useState(() => initialPdfUi.fitWidth);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(
    () => loadDocOutlineUi(vaultPath, path).open,
  );
  const [outlineWidth, setOutlineWidth] = useState(
    () => loadDocOutlineUi(vaultPath, path).width,
  );
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const findInputRef = useRef<HTMLInputElement>(null);

  scaleRef.current = scale;
  fitWidthRef.current = fitWidth;
  pageRef.current = page;

  const persistZoom = useCallback(
    (nextScale: number, nextFit: boolean) => {
      saveDocPdfZoom(vaultPath, path, nextScale, nextFit);
    },
    [vaultPath, path],
  );

  const persistPage = useCallback(
    (nextPage: number, immediate = false) => {
      const save = () => {
        pageSaveTimerRef.current = null;
        saveDocPdfPage(vaultPath, path, nextPage);
      };
      if (pageSaveTimerRef.current != null) {
        window.clearTimeout(pageSaveTimerRef.current);
        pageSaveTimerRef.current = null;
      }
      if (immediate) save();
      else {
        pageSaveTimerRef.current = window.setTimeout(
          save,
          PAGE_SAVE_DEBOUNCE_MS,
        );
      }
    },
    [vaultPath, path],
  );

  useEffect(() => {
    const outlineUi = loadDocOutlineUi(vaultPath, path);
    setOutlineWidth(outlineUi.width);
    setOutlineOpen(outlineUi.open);
    const pdfUi = loadDocPdfUi(vaultPath, path);
    scaleRef.current = pdfUi.scale;
    fitWidthRef.current = pdfUi.fitWidth;
    pageRef.current = pdfUi.page;
    renderedScaleRef.current = pdfUi.fitWidth
      ? PDF_SCALE_DEFAULT
      : pdfUi.scale;
    setScale(pdfUi.scale);
    setFitWidth(pdfUi.fitWidth);
    setPage(pdfUi.page);
    restorePageRef.current = pdfUi.page;
  }, [vaultPath, path]);

  const persistOutlineWidth = useCallback(
    (width: number) => {
      saveDocOutlineWidth(vaultPath, path, width);
    },
    [vaultPath, path],
  );

  const setOutlineOpenPersisted = useCallback(
    (open: boolean) => {
      setOutlineOpen(open);
      saveDocOutlineOpen(vaultPath, path, open);
    },
    [vaultPath, path],
  );

  const onOutlineSplitterPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = outlineWidth;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      target.classList.add("is-active");

      const onMove = (ev: PointerEvent) => {
        setOutlineWidth(clampOutlineWidth(startWidth + (ev.clientX - startX)));
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.classList.remove("is-active");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setOutlineWidth((w) => {
          persistOutlineWidth(w);
          return w;
        });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [outlineWidth, persistOutlineWidth],
  );

  const jumpToPage = useCallback(
    (n: number, opts?: { persist?: boolean }) => {
      const max = docRef.current?.numPages ?? n;
      const clamped = clampPdfPage(n, max);
      setPage(clamped);
      pageRef.current = clamped;
      const el = pageRefs.current.get(clamped);
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      if (opts?.persist !== false) persistPage(clamped, true);
    },
    [persistPage],
  );

  const cancelActiveTasks = useCallback(() => {
    for (const task of activeTasksRef.current) {
      try {
        task.cancel();
      } catch {
        // ignore
      }
    }
    activeTasksRef.current = [];
  }, []);

  /** Instant visual zoom via CSS; full raster waits for debounce. */
  const applyZoomPreview = useCallback((targetScale: number) => {
    const base = renderedScaleRef.current;
    if (!base || pageRefs.current.size === 0) return;
    const factor = targetScale / base;
    for (const [, pageEl] of pageRefs.current) {
      const bw = Number(pageEl.dataset.renderedWidth || 0);
      const bh = Number(pageEl.dataset.renderedHeight || 0);
      if (!bw || !bh) continue;
      pageEl.style.width = `${Math.floor(bw * factor)}px`;
      pageEl.style.height = `${Math.floor(bh * factor)}px`;
      const inner = pageEl.querySelector(
        ".pdf-viewer__page-inner",
      ) as HTMLElement | null;
      if (!inner) continue;
      if (Math.abs(factor - 1) < 0.001) {
        inner.style.transform = "";
        pageEl.classList.remove("is-zooming");
      } else {
        inner.style.transform = `scale(${factor})`;
        inner.style.transformOrigin = "0 0";
        pageEl.classList.add("is-zooming");
      }
    }
  }, []);

  const clearZoomPreview = useCallback(() => {
    for (const [, pageEl] of pageRefs.current) {
      pageEl.classList.remove("is-zooming");
      const inner = pageEl.querySelector(
        ".pdf-viewer__page-inner",
      ) as HTMLElement | null;
      if (inner) inner.style.transform = "";
    }
  }, []);

  const renderPages = useCallback(
    async (doc: PDFDocumentProxy, nextScale: number, asFitWidth: boolean) => {
      const token = ++renderToken.current;
      cancelActiveTasks();
      const container = scrollRef.current;
      if (!container) return;
      const pdfjs = await getPdfjs();
      if (token !== renderToken.current) return;

      let effectiveScale = nextScale;
      if (asFitWidth) {
        const first = await doc.getPage(1);
        const base = first.getViewport({ scale: 1 });
        const avail = Math.max(200, container.clientWidth - 32);
        effectiveScale = avail / base.width;
        first.cleanup();
      }

      for (let i = 1; i <= doc.numPages; i++) {
        if (token !== renderToken.current) return;
        const pdfPage = await doc.getPage(i);
        if (token !== renderToken.current) {
          pdfPage.cleanup();
          return;
        }
        const viewport = pdfPage.getViewport({ scale: effectiveScale });

        let pageEl = pageRefs.current.get(i);
        if (!pageEl) {
          pageEl = document.createElement("div");
          pageEl.className = "pdf-viewer__page";
          pageEl.dataset.page = String(i);
          const inner = document.createElement("div");
          inner.className = "pdf-viewer__page-inner";
          const canvas = document.createElement("canvas");
          canvas.className = "pdf-viewer__page-canvas";
          const textLayer = document.createElement("div");
          textLayer.className = "textLayer pdf-viewer__text-layer";
          inner.append(canvas, textLayer);
          pageEl.appendChild(inner);
          pageRefs.current.set(i, pageEl);
          container.appendChild(pageEl);
        }

        const canvas = pageEl.querySelector(
          "canvas.pdf-viewer__page-canvas",
        ) as HTMLCanvasElement | null;
        const textLayerDiv = pageEl.querySelector(
          ".pdf-viewer__text-layer",
        ) as HTMLDivElement | null;
        if (!canvas || !textLayerDiv) {
          pdfPage.cleanup();
          continue;
        }

        const w = Math.floor(viewport.width);
        const h = Math.floor(viewport.height);
        pageEl.dataset.renderedWidth = String(w);
        pageEl.dataset.renderedHeight = String(h);
        pageEl.style.width = `${w}px`;
        pageEl.style.height = `${h}px`;

        const inner = pageEl.querySelector(
          ".pdf-viewer__page-inner",
        ) as HTMLDivElement | null;
        if (inner) {
          inner.style.width = `${w}px`;
          inner.style.height = `${h}px`;
          inner.style.transform = "";
        }

        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          pdfPage.cleanup();
          continue;
        }

        const renderTask = pdfPage.render({
          canvasContext: ctx,
          viewport,
          canvas,
        });
        activeTasksRef.current.push(renderTask);
        try {
          await renderTask.promise;
        } catch {
          pdfPage.cleanup();
          if (token !== renderToken.current) return;
          continue;
        }
        if (token !== renderToken.current) {
          pdfPage.cleanup();
          return;
        }

        textLayerDiv.replaceChildren();
        // pdf.js TextLayer sizes via round(var(--total-scale-factor) * pageDims).
        textLayerDiv.style.setProperty("--total-scale-factor", String(viewport.scale));
        textLayerDiv.style.setProperty("--scale-round-x", "1px");
        textLayerDiv.style.setProperty("--scale-round-y", "1px");
        const textLayer = new pdfjs.TextLayer({
          textContentSource: pdfPage.streamTextContent(),
          container: textLayerDiv,
          viewport,
        });
        activeTasksRef.current.push(textLayer);
        try {
          await textLayer.render();
        } catch {
          // cancelled or empty
        }
        pdfPage.cleanup();
      }

      if (token !== renderToken.current) return;

      for (const [n, pageEl] of [...pageRefs.current.entries()]) {
        if (n > doc.numPages) {
          pageEl.remove();
          pageRefs.current.delete(n);
        }
      }

      renderedScaleRef.current = effectiveScale;
      clearZoomPreview();
      if (asFitWidth) {
        // Keep toolbar % in sync with computed fit scale.
        const rounded = clampPdfScale(effectiveScale);
        scaleRef.current = rounded;
        setScale(rounded);
        persistZoom(rounded, true);
      } else {
        persistZoom(clampPdfScale(nextScale), false);
      }
    },
    [cancelActiveTasks, clearZoomPreview, persistZoom],
  );

  const scheduleRender = useCallback(
    (targetScale: number, asFitWidth: boolean, immediate = false) => {
      if (renderTimerRef.current != null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      const run = () => {
        renderTimerRef.current = null;
        const doc = docRef.current;
        if (!doc) return;
        void renderPages(doc, targetScale, asFitWidth);
      };
      if (immediate) run();
      else {
        renderTimerRef.current = window.setTimeout(run, RENDER_DEBOUNCE_MS);
      }
    },
    [renderPages],
  );

  const setScaleAndPreview = useCallback(
    (next: number, opts?: { immediate?: boolean }) => {
      const clamped = clampPdfScale(next);
      scaleRef.current = clamped;
      fitWidthRef.current = false;
      setFitWidth(false);
      setScale(clamped);
      applyZoomPreview(clamped);
      scheduleRender(clamped, false, opts?.immediate === true);
    },
    [applyZoomPreview, scheduleRender],
  );

  const bumpScale = useCallback(
    (delta: number) => {
      setScaleAndPreview(scaleRef.current + delta);
    },
    [setScaleAndPreview],
  );

  // Non-passive wheel listener so Ctrl+wheel can prevent browser page zoom.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const step =
        Math.abs(event.deltaY) > 40 ? SCALE_STEP * 1.5 : SCALE_STEP;
      const delta = event.deltaY < 0 ? step : -step;
      setScaleAndPreview(scaleRef.current + delta);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [setScaleAndPreview, loading, numPages]);

  useEffect(() => {
    let cancelled = false;
    pageRefs.current.forEach((c) => c.remove());
    pageRefs.current.clear();
    cancelActiveTasks();
    if (renderTimerRef.current != null) {
      window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }
    docRef.current = null;
    setLoading(true);
    setError(null);
    setOutline([]);
    setNumPages(0);
    findCursorRef.current = 0;

    const pdfUi = loadDocPdfUi(vaultPath, path);
    scaleRef.current = pdfUi.scale;
    fitWidthRef.current = pdfUi.fitWidth;
    pageRef.current = pdfUi.page;
    renderedScaleRef.current = pdfUi.fitWidth
      ? PDF_SCALE_DEFAULT
      : pdfUi.scale;
    setScale(pdfUi.scale);
    setFitWidth(pdfUi.fitWidth);
    setPage(pdfUi.page);
    restorePageRef.current = pdfUi.page;

    void (async () => {
      try {
        const abs = await absolutePath(path);
        const url = convertFileSrc(abs);
        const pdfjs = await getPdfjs();
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          await doc.cleanup();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        try {
          const raw = await doc.getOutline();
          const items = await outlineFromPdf(doc, raw);
          if (!cancelled) {
            setOutline(items);
            if (items.length) {
              const saved = hasDocOutlineUi(vaultPath, path);
              const ui = loadDocOutlineUi(vaultPath, path);
              if (!saved) {
                setOutlineOpenPersisted(true);
              } else {
                setOutlineOpen(ui.open);
              }
            } else {
              setOutlineOpen(false);
            }
          }
        } catch {
          // no outline
        }
        await renderPages(doc, scaleRef.current, fitWidthRef.current);
        if (cancelled) return;
        setLoading(false);
        const pending = takePendingPdfPage();
        if (pending != null) {
          restorePageRef.current = null;
          jumpToPage(pending, { persist: true });
        } else {
          const restore = restorePageRef.current;
          restorePageRef.current = null;
          if (restore != null && restore > 1) {
            jumpToPage(restore, { persist: false });
          }
        }
      } catch (e) {
        if (!cancelled) {
          setLoading(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderToken.current += 1;
      cancelActiveTasks();
      if (renderTimerRef.current != null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      if (pageSaveTimerRef.current != null) {
        window.clearTimeout(pageSaveTimerRef.current);
        pageSaveTimerRef.current = null;
      }
      const doc = docRef.current;
      docRef.current = null;
      void doc?.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on path only
  }, [path]);

  // Fit-width: re-render when toggled on (no CSS preview for fit).
  useEffect(() => {
    if (!fitWidth || loading) return;
    const doc = docRef.current;
    if (!doc) return;
    scheduleRender(scaleRef.current, true, true);
  }, [fitWidth, loading, scheduleRender]);

  useEffect(() => {
    if (pendingPdfPage == null || loading || numPages < 1) return;
    const pageNum = takePendingPdfPage();
    if (pageNum != null) jumpToPage(pageNum, { persist: true });
  }, [pendingPdfPage, loading, numPages, takePendingPdfPage, jumpToPage]);

  useEffect(() => {
    const onScroll = () => {
      const root = scrollRef.current;
      if (!root || pageRefs.current.size === 0) return;
      const mid = root.scrollTop + root.clientHeight / 3;
      let best = 1;
      let bestDist = Infinity;
      for (const [, pageEl] of pageRefs.current) {
        const top = pageEl.offsetTop;
        const dist = Math.abs(top - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = Number(pageEl.dataset.page || 1);
        }
      }
      if (best !== pageRef.current) {
        pageRef.current = best;
        setPage(best);
        persistPage(best);
      }
    };
    const root = scrollRef.current;
    root?.addEventListener("scroll", onScroll, { passive: true });
    return () => root?.removeEventListener("scroll", onScroll);
  }, [numPages, loading, persistPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.code === "KeyF") {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.focus());
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        setFindStatus("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  const runFind = async (direction: 1 | -1) => {
    const doc = docRef.current;
    const q = findQuery.trim().toLowerCase();
    if (!doc || !q) return;

    const start =
      direction === 1
        ? findCursorRef.current + 1
        : findCursorRef.current - 1;
    for (let offset = 0; offset < doc.numPages; offset++) {
      const pageNum =
        ((((start - 1 + direction * offset) % doc.numPages) + doc.numPages) %
          doc.numPages) +
        1;
      const pdfPage = await doc.getPage(pageNum);
      const content = await pdfPage.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .toLowerCase();
      pdfPage.cleanup();
      if (text.includes(q)) {
        findCursorRef.current = pageNum;
        jumpToPage(pageNum);
        setFindStatus(`Page ${pageNum}`);
        return;
      }
    }
    setFindStatus("No matches");
  };

  const onFindKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runFind(e.shiftKey ? -1 : 1);
    }
  };

  const showOutline = outlineOpen && outline.length > 0;

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__toolbar">
        <button
          type="button"
          className={outlineOpen ? "is-active" : ""}
          disabled={!outline.length}
          title="Outline"
          aria-pressed={outlineOpen}
          onClick={() => setOutlineOpenPersisted(!outlineOpen)}
        >
          Outline
        </button>
        <div className="pdf-viewer__toolbar-group">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => jumpToPage(page - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <label className="pdf-viewer__page-label">
            <input
              type="number"
              min={1}
              max={numPages || 1}
              value={page}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) jumpToPage(n);
              }}
            />
            <span>/ {numPages || "—"}</span>
          </label>
          <button
            type="button"
            disabled={page >= numPages}
            onClick={() => jumpToPage(page + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
        <div className="pdf-viewer__toolbar-group">
          <button
            type="button"
            onClick={() => bumpScale(-SCALE_STEP)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className={fitWidth ? "" : "is-active"}
            onClick={() => setScaleAndPreview(PDF_SCALE_DEFAULT, { immediate: true })}
          >
            {fitWidth ? "Fit" : `${Math.round(scale * 100)}%`}
          </button>
          <button
            type="button"
            onClick={() => bumpScale(SCALE_STEP)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className={fitWidth ? "is-active" : ""}
            onClick={() => {
              fitWidthRef.current = true;
              setFitWidth(true);
            }}
          >
            Fit width
          </button>
        </div>
        <button
          type="button"
          className={findOpen ? "is-active" : ""}
          onClick={() => {
            setFindOpen((v) => !v);
            requestAnimationFrame(() => findInputRef.current?.focus());
          }}
        >
          Find
        </button>
        <div className="pdf-viewer__tags">
          <PdfDocumentTags path={path} />
        </div>
      </div>

      {findOpen ? (
        <div className="pdf-viewer__find">
          <input
            ref={findInputRef}
            type="search"
            placeholder="Find in document…"
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              findCursorRef.current = 0;
            }}
            onKeyDown={onFindKeyDown}
          />
          <button type="button" onClick={() => void runFind(-1)}>
            Prev
          </button>
          <button type="button" onClick={() => void runFind(1)}>
            Next
          </button>
          {findStatus ? (
            <span className="pdf-viewer__find-status">{findStatus}</span>
          ) : null}
        </div>
      ) : null}

      <div className="pdf-viewer__body">
        {showOutline ? (
          <>
            <aside
              className="pdf-viewer__outline"
              style={{ width: outlineWidth, flexBasis: outlineWidth }}
            >
              <OutlineTree
                items={outline}
                activePage={page}
                onSelect={jumpToPage}
              />
            </aside>
            <div
              className="app-splitter outline-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize outline"
              aria-valuenow={outlineWidth}
              aria-valuemin={OUTLINE_WIDTH_MIN}
              aria-valuemax={OUTLINE_WIDTH_MAX}
              tabIndex={0}
              onPointerDown={onOutlineSplitterPointerDown}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const delta = e.key === "ArrowRight" ? 16 : -16;
                setOutlineWidth((w) => {
                  const next = clampOutlineWidth(w + delta);
                  persistOutlineWidth(next);
                  return next;
                });
              }}
            />
          </>
        ) : null}
        <div className="pdf-viewer__scroll" ref={scrollRef}>
          {loading ? (
            <div className="pdf-viewer__status">Loading PDF…</div>
          ) : null}
          {error ? (
            <div className="pdf-viewer__status is-error">{error}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

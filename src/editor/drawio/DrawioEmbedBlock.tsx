import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { isDrawioPath, readNote } from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { selectAtomBlockOnMouseDown } from "../selectAtomBlock";
import { DEFAULT_DRAWIO_PREVIEW_WIDTH } from "./constants";
import { exportDrawioXmlToSvg, normalizeExportedSvg } from "./exportSvg";
import {
  drawioPreviewCacheKey,
  getOrRenderDrawioSvg,
} from "./previewCache";

function DrawioPreview({
  src,
  width,
}: {
  src: string;
  width: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!src.trim() || !isDrawioPath(src)) {
        setError("Missing diagram path");
        return;
      }
      setPending(true);
      setError(null);
      try {
        const xml = await readNote(src);
        if (!xml.trim()) throw new Error("Diagram file is empty");
        const key = drawioPreviewCacheKey(src, xml);
        const raw = await getOrRenderDrawioSvg(key, () =>
          exportDrawioXmlToSvg(xml),
        );
        const svg = normalizeExportedSvg(raw);
        if (cancelled) return;
        if (containerRef.current) containerRef.current.innerHTML = svg;
        setPending(false);
      } catch (e) {
        if (cancelled) return;
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
        if (containerRef.current) containerRef.current.innerHTML = "";
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src.trim()) {
    return (
      <div className="diagram-block__empty">Choose a .drawio file to embed</div>
    );
  }

  return (
    <div className="drawio-embed__preview" style={{ width: "100%" }}>
      {pending ? <div className="diagram-block__pending">Rendering…</div> : null}
      {error ? <div className="diagram-block__error">{error}</div> : null}
      <div
        ref={containerRef}
        className="drawio-embed__svg"
        hidden={Boolean(error) || pending}
        style={{ maxWidth: width }}
      />
    </div>
  );
}

function clientXOf(
  event: ReactMouseEvent | ReactTouchEvent | MouseEvent | TouchEvent,
) {
  return "touches" in event ? event.touches[0].clientX : event.clientX;
}

export function DrawioEmbedView(props: {
  block: {
    id: string;
    props: { src: string; previewWidth: number };
  };
  editor: {
    isEditable: boolean;
    domElement: HTMLElement | undefined;
    prosemirrorView?: import("@tiptap/pm/view").EditorView;
    updateBlock: (
      block: { id: string } | string,
      update: { props: Partial<{ src: string; previewWidth: number }> },
    ) => void;
  };
}) {
  const { block, editor } = props;
  const openNote = useVaultStore((s) => s.openNote);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(
    block.props.previewWidth || DEFAULT_DRAWIO_PREVIEW_WIDTH,
  );
  const widthRef = useRef(width);
  widthRef.current = width;
  const [hovered, setHovered] = useState(false);
  const [resizeParams, setResizeParams] = useState<
    | {
        initialWidth: number;
        initialClientX: number;
        handleUsed: "left" | "right";
      }
    | undefined
  >(undefined);

  useEffect(() => {
    if (resizeParams) return;
    setWidth(block.props.previewWidth || DEFAULT_DRAWIO_PREVIEW_WIDTH);
  }, [block.props.previewWidth, resizeParams]);

  useEffect(() => {
    if (!resizeParams) return;

    const onMove = (event: MouseEvent | TouchEvent) => {
      const x = clientXOf(event);
      const delta =
        resizeParams.handleUsed === "left"
          ? resizeParams.initialClientX - x
          : x - resizeParams.initialClientX;
      const maxWidth =
        editor.domElement?.firstElementChild?.clientWidth ||
        wrapperRef.current?.parentElement?.clientWidth ||
        Number.MAX_VALUE;
      setWidth(
        Math.min(Math.max(resizeParams.initialWidth + delta, 64), maxWidth),
      );
    };

    const onUp = () => {
      setResizeParams(undefined);
      const next = Math.round(widthRef.current);
      if (next !== block.props.previewWidth) {
        editor.updateBlock(block, { props: { previewWidth: next } });
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [block, editor, resizeParams]);

  const startResize = useCallback(
    (handleUsed: "left" | "right") =>
      (event: ReactMouseEvent | ReactTouchEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setResizeParams({
          handleUsed,
          initialWidth: wrapperRef.current?.clientWidth ?? widthRef.current,
          initialClientX: clientXOf(event),
        });
      },
    [],
  );

  const showHandles = editor.isEditable && (hovered || Boolean(resizeParams));

  return (
    <div
      className="drawio-embed"
      contentEditable={false}
      onMouseDown={(event) =>
        selectAtomBlockOnMouseDown(event, editor, block.id)
      }
    >
      <div className="diagram-block__toolbar">
        <span className="diagram-block__label">Draw.io</span>
        <span className="drawio-embed__src" title={block.props.src}>
          {block.props.src || "—"}
        </span>
        <button
          type="button"
          className="diagram-block__mode"
          disabled={!block.props.src}
          onClick={() => {
            if (block.props.src) void openNote(block.props.src, { preview: false });
          }}
        >
          Open
        </button>
      </div>
      <div
        ref={wrapperRef}
        className="drawio-embed__frame bn-visual-media-wrapper"
        style={{ width, position: "relative", maxWidth: "100%" }}
        onMouseEnter={() => {
          if (editor.isEditable) setHovered(true);
        }}
        onMouseLeave={() => setHovered(false)}
        onDoubleClick={() => {
          if (block.props.src) void openNote(block.props.src, { preview: false });
        }}
      >
        <DrawioPreview src={block.props.src} width={width} />
        {editor.isEditable ? (
          <>
            <div
              className="bn-resize-handle"
              style={{
                left: "4px",
                display: showHandles ? "block" : "none",
              }}
              onMouseDown={startResize("left")}
              onTouchStart={startResize("left")}
            />
            <div
              className="bn-resize-handle"
              style={{
                right: "4px",
                display: showHandles ? "block" : "none",
              }}
              onMouseDown={startResize("right")}
              onTouchStart={startResize("right")}
            />
            {resizeParams ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                }}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}


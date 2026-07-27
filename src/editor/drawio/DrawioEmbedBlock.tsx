import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { isDrawioPath, readNote } from "../../lib/vaultApi";
import {
  formatDrawioFenceBody,
  parseDrawioFenceBody,
} from "../../lib/wikiMarkdown";
import { useVaultStore } from "../../store/vaultStore";
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

function DrawioEmbedView(props: {
  block: {
    id: string;
    props: { src: string; previewWidth: number };
  };
  editor: {
    isEditable: boolean;
    updateBlock: (
      block: { id: string } | string,
      update: { props: Partial<{ src: string; previewWidth: number }> },
    ) => void;
  };
}) {
  const { block, editor } = props;
  const openNote = useVaultStore((s) => s.openNote);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const width = block.props.previewWidth || DEFAULT_DRAWIO_PREVIEW_WIDTH;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !editor.isEditable) return;

    const left = document.createElement("div");
    left.className = "bn-resize-handle";
    left.style.left = "4px";
    left.style.display = "none";
    const right = document.createElement("div");
    right.className = "bn-resize-handle";
    right.style.right = "4px";
    right.style.display = "none";
    wrapper.appendChild(left);
    wrapper.appendChild(right);

    let resize:
      | {
          handle: "left" | "right";
          initialWidth: number;
          initialX: number;
        }
      | undefined;
    let currentWidth = width;

    const onMove = (event: MouseEvent) => {
      if (!resize) return;
      const delta =
        resize.handle === "left"
          ? resize.initialX - event.clientX
          : event.clientX - resize.initialX;
      currentWidth = Math.min(
        Math.max(resize.initialWidth + delta, 64),
        wrapper.parentElement?.clientWidth || 1200,
      );
      wrapper.style.width = `${currentWidth}px`;
    };

    const onUp = () => {
      if (!resize) return;
      resize = undefined;
      left.style.display = "none";
      right.style.display = "none";
      if (currentWidth !== block.props.previewWidth) {
        editor.updateBlock(block, { props: { previewWidth: currentWidth } });
      }
    };

    const leftDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      resize = {
        handle: "left",
        initialWidth: wrapper.getBoundingClientRect().width,
        initialX: event.clientX,
      };
      left.style.display = "";
      right.style.display = "";
    };
    const rightDown = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      resize = {
        handle: "right",
        initialWidth: wrapper.getBoundingClientRect().width,
        initialX: event.clientX,
      };
      left.style.display = "";
      right.style.display = "";
    };

    const onEnter = () => {
      left.style.display = "";
      right.style.display = "";
    };
    const onLeave = () => {
      if (resize) return;
      left.style.display = "none";
      right.style.display = "none";
    };

    left.addEventListener("mousedown", leftDown);
    right.addEventListener("mousedown", rightDown);
    wrapper.addEventListener("mouseenter", onEnter);
    wrapper.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      left.removeEventListener("mousedown", leftDown);
      right.removeEventListener("mousedown", rightDown);
      wrapper.removeEventListener("mouseenter", onEnter);
      wrapper.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      left.remove();
      right.remove();
    };
  }, [block, editor, width]);

  return (
    <div className="drawio-embed" contentEditable={false}>
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
        className="drawio-embed__frame"
        style={{ width, position: "relative" }}
        onDoubleClick={() => {
          if (block.props.src) void openNote(block.props.src, { preview: false });
        }}
      >
        <DrawioPreview src={block.props.src} width={width} />
      </div>
    </div>
  );
}

function parseDrawioElement(element: HTMLElement):
  | { src: string; previewWidth: number }
  | undefined {
  // Preferred: fenced ```drawio
  if (element.tagName === "PRE") {
    if (
      element.childElementCount !== 1 ||
      element.firstElementChild?.tagName !== "CODE"
    ) {
      return undefined;
    }
    const codeEl = element.firstElementChild!;
    const language =
      codeEl.getAttribute("data-language") ||
      codeEl.className
        .split(/\s+/)
        .find((name) => name.startsWith("language-"))
        ?.replace("language-", "");
    if (language !== "drawio") return undefined;
    const parsed = parseDrawioFenceBody(codeEl.textContent ?? "");
    if (!parsed?.src) return undefined;
    return {
      src: parsed.src,
      previewWidth: parsed.previewWidth ?? DEFAULT_DRAWIO_PREVIEW_WIDTH,
    };
  }

  // Legacy HTML from earlier builds
  if (element.tagName === "DIV") {
    const src = element.getAttribute("data-drawio-src");
    if (!src) return undefined;
    const widthRaw = element.getAttribute("data-preview-width");
    const previewWidth = widthRaw ? Number(widthRaw) : DEFAULT_DRAWIO_PREVIEW_WIDTH;
    return {
      src,
      previewWidth:
        Number.isFinite(previewWidth) && previewWidth > 0
          ? previewWidth
          : DEFAULT_DRAWIO_PREVIEW_WIDTH,
    };
  }

  return undefined;
}

export const createDrawioBlock = createReactBlockSpec(
  {
    type: "drawio",
    propSchema: {
      src: { default: "" },
      previewWidth: { default: DEFAULT_DRAWIO_PREVIEW_WIDTH },
    },
    content: "none",
  },
  {
    meta: {
      isolating: true,
    },
    runsBefore: ["codeBlock"],
    parse: (element) => parseDrawioElement(element),
    toExternalHTML: ({ block }) => (
      <pre>
        <code data-language="drawio">
          {formatDrawioFenceBody(
            block.props.src,
            block.props.previewWidth || DEFAULT_DRAWIO_PREVIEW_WIDTH,
          )}
        </code>
      </pre>
    ),
    render: (props) => <DrawioEmbedView {...props} />,
  },
  [
    createExtension({
      key: "drawio-input-rule",
      runsBefore: ["code-block-keyboard-shortcuts"],
      inputRules: [
        {
          find: /^```drawio\s$/,
          replace: () => ({
            type: "drawio",
            props: {
              src: "",
              previewWidth: DEFAULT_DRAWIO_PREVIEW_WIDTH,
            },
          }),
        },
      ],
    }),
  ],
);

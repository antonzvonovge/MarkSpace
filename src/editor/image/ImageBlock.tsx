import { defaultProps, imageParse } from "@blocknote/core";
import {
  FileBlockWrapper,
  FigureWithCaption,
  LinkWithCaption,
  createReactBlockSpec,
  useBlockNoteEditor,
} from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, PointerEvent as ReactPointerEvent } from "react";
import { RiImage2Fill } from "react-icons/ri";
import { positivePx } from "../../lib/imageMarkdown";
import {
  MAX_IMAGE_EDGE,
  handleChangesHeight,
  resizeImage,
  type ImageResizeHandle,
  type ImageResizeOrigin,
} from "./imageResize";

const HANDLES: { id: ImageResizeHandle; x: string; y: string }[] = [
  { id: "nw", x: "0%", y: "0%" },
  { id: "n", x: "50%", y: "0%" },
  { id: "ne", x: "100%", y: "0%" },
  { id: "e", x: "100%", y: "50%" },
  { id: "se", x: "100%", y: "100%" },
  { id: "s", x: "50%", y: "100%" },
  { id: "sw", x: "0%", y: "100%" },
  { id: "w", x: "0%", y: "50%" },
];

const IMAGE_ICON = <RiImage2Fill size={24} />;

type ImageProps = {
  name: string;
  url: string;
  caption: string;
  showPreview: boolean;
  textAlignment: "left" | "center" | "right" | "justify";
  previewWidth?: number;
  previewHeight?: number;
};

type LiveSize = {
  width: number;
  height?: number;
};

/**
 * BlockNote's `useResolveUrl` throws when the resolved URL is empty. Paste
 * inserts a placeholder image with `url: ""` before the upload finishes, so
 * resolve locally and keep the original path if resolution yields nothing.
 */
function useImageSrc(url: string): string {
  const editor = useBlockNoteEditor();
  const [src, setSrc] = useState(url);

  useEffect(() => {
    if (!url) {
      setSrc("");
      return;
    }
    let cancelled = false;
    setSrc(url);
    void (async () => {
      try {
        const resolved = editor.resolveFileUrl
          ? await editor.resolveFileUrl(url)
          : url;
        if (!cancelled) setSrc(resolved || url);
      } catch {
        if (!cancelled) setSrc(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, url]);

  return src;
}

function positiveProp(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function frameClass(stretched: boolean, dragging: boolean): string {
  const names = ["bn-visual-media-wrapper", "image-frame"];
  if (stretched) names.push("is-stretched");
  if (dragging) names.push("is-resizing");
  return names.join(" ");
}

function MarkspaceImageView(props: {
  block: { props: ImageProps };
  editable: boolean;
  fileProps: object;
  onCommit: (size: { previewWidth: number; previewHeight?: number }) => void;
}) {
  const { block } = props;
  const url = block.props.url;
  const showPreview = block.props.showPreview !== false && Boolean(url);
  const previewWidth = positiveProp(block.props.previewWidth);
  const previewHeight = positiveProp(block.props.previewHeight);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ImageResizeOrigin | null>(null);
  const detachDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachDragRef.current?.(), []);
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<LiveSize | null>(null);

  const sizeKey = `${previewWidth ?? 0}x${previewHeight ?? 0}`;
  const [trackedSize, setTrackedSize] = useState(sizeKey);
  if (!dragging && trackedSize !== sizeKey) {
    setTrackedSize(sizeKey);
    if (live) setLive(null);
  }

  const width = live?.width ?? previewWidth;
  const height = live?.height ?? previewHeight;
  const src = useImageSrc(url);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.editable) return;
    const handle = event.currentTarget.dataset.handle;
    const frame = frameRef.current;
    if (!handle || !frame) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = frame.getBoundingClientRect();
    const maxWidth =
      frame.closest(".bn-editor")?.clientWidth ||
      frame.closest(".bn-container")?.clientWidth ||
      MAX_IMAGE_EDGE;
    dragRef.current = {
      handle: handle as ImageResizeHandle,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: Math.max(1, Math.round(rect.width)),
      startHeight: Math.max(1, Math.round(rect.height)),
      textAlignment: block.props.textAlignment,
      maxWidth,
    };
    setDragging(true);
    detachDragRef.current?.();

    const move = (ev: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const next = resizeImage(current, ev.clientX, ev.clientY);
      setLive({
        width: next.width,
        height: handleChangesHeight(current.handle) ? next.height : undefined,
      });
    };
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      detachDragRef.current = null;
    };
    const up = (ev: PointerEvent) => {
      detach();
      const current = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!current) return;
      const next = resizeImage(current, ev.clientX, ev.clientY);
      const changesHeight = handleChangesHeight(current.handle);
      setLive({
        width: next.width,
        height: changesHeight ? next.height : undefined,
      });
      props.onCommit({
        previewWidth: next.width,
        ...(changesHeight ? { previewHeight: next.height } : {}),
      });
    };
    detachDragRef.current = detach;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <FileBlockWrapper
      {...(props.fileProps as ComponentProps<typeof FileBlockWrapper>)}
      buttonIcon={IMAGE_ICON}
      style={
        showPreview
          ? { width: width ? `${width}px` : "fit-content" }
          : undefined
      }
    >
      {showPreview ? (
        <div
          ref={frameRef}
          className={frameClass(height != null, dragging)}
          style={height != null ? { height: `${height}px` } : undefined}
          contentEditable={false}
        >
          <img
            className="bn-visual-media"
            src={src}
            alt={block.props.name || ""}
            width={width}
            height={height}
            draggable={false}
            contentEditable={false}
          />
          {props.editable
            ? HANDLES.map((handle) => (
                <div
                  key={handle.id}
                  className="image-resize-handle"
                  data-handle={handle.id}
                  style={{ left: handle.x, top: handle.y }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onPointerDown={onHandlePointerDown}
                />
              ))
            : null}
        </div>
      ) : null}
    </FileBlockWrapper>
  );
}

function ImageExternal(props: { block: { props: ImageProps } }) {
  const { block } = props;
  if (!block.props.url) return <p>Add image</p>;

  const alt = block.props.name || "";
  const image =
    block.props.showPreview !== false ? (
      <img
        src={block.props.url}
        alt={alt}
        width={positiveProp(block.props.previewWidth)}
        height={positiveProp(block.props.previewHeight)}
      />
    ) : (
      <a href={block.props.url}>{block.props.name || block.props.url}</a>
    );

  if (!block.props.caption) return image;
  if (block.props.showPreview === false) {
    return (
      <LinkWithCaption caption={block.props.caption}>{image}</LinkWithCaption>
    );
  }
  return (
    <FigureWithCaption caption={block.props.caption}>{image}</FigureWithCaption>
  );
}

const parseStockImage = imageParse();

function parseMarkspaceImage(element: HTMLElement) {
  const parsed = parseStockImage(element);
  if (!parsed) return undefined;
  const img =
    element.tagName === "IMG" ? element : element.querySelector("img");
  const previewHeight = positivePx(img?.getAttribute("height"));
  if (!previewHeight) return parsed;
  return { ...parsed, previewHeight };
}

export const markspaceImageBlock = createReactBlockSpec(
  {
    type: "image" as const,
    propSchema: {
      textAlignment: defaultProps.textAlignment,
      backgroundColor: defaultProps.backgroundColor,
      name: { default: "" as const },
      url: { default: "" as const },
      caption: { default: "" as const },
      showPreview: { default: true },
      previewWidth: {
        default: undefined,
        type: "number" as const,
      },
      previewHeight: {
        default: undefined,
        type: "number" as const,
      },
    },
    content: "none" as const,
  },
  {
    meta: {
      fileBlockAccept: ["image/*"],
    },
    render: (props) => (
      <MarkspaceImageView
        block={props.block}
        editable={props.editor.isEditable}
        fileProps={props}
        onCommit={(size) => {
          props.editor.updateBlock(props.block, { props: size });
        }}
      />
    ),
    parse: parseMarkspaceImage,
    toExternalHTML: (props) => <ImageExternal block={props.block} />,
    runsBefore: ["file"],
  },
);

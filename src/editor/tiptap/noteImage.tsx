import { convertFileSrc } from "@tauri-apps/api/core";
import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { useEffect, useState } from "react";
import {
  absolutePath,
  joinPath,
  parentPath,
} from "../../lib/vaultApi";

function isRemoteOrDataUrl(url: string): boolean {
  return (
    /^(https?:|data:|blob:|asset:)/i.test(url) || url.startsWith("//")
  );
}

async function resolveDisplaySrc(
  url: string,
  notePath: string,
): Promise<string> {
  if (!url || isRemoteOrDataUrl(url)) return url;
  const cleaned = url.replace(/^\.\//, "");
  const assetRel = joinPath(parentPath(notePath), cleaned);
  try {
    const abs = await absolutePath(assetRel);
    return convertFileSrc(abs);
  } catch {
    return url;
  }
}

function notePathFromEditor(editor: ReactNodeViewProps["editor"]): string {
  const ext = editor.extensionManager.extensions.find(
    (e) => e.name === "notePath",
  );
  return typeof ext?.options?.path === "string" ? ext.options.path : "";
}

function NoteImageView(props: ReactNodeViewProps) {
  const { node, selected, editor } = props;
  const src = String(node.attrs.src ?? "");
  const alt = String(node.attrs.alt ?? "");
  const width = node.attrs.width as number | string | null | undefined;
  const notePath = notePathFromEditor(editor);

  const [displaySrc, setDisplaySrc] = useState(src);

  useEffect(() => {
    let cancelled = false;
    void resolveDisplaySrc(src, notePath).then((next) => {
      if (!cancelled) setDisplaySrc(next);
    });
    return () => {
      cancelled = true;
    };
  }, [src, notePath]);

  const widthPx =
    width != null && width !== ""
      ? typeof width === "number"
        ? width
        : Number(String(width))
      : null;
  const style =
    widthPx != null && Number.isFinite(widthPx) && widthPx > 0
      ? { width: `${Math.round(widthPx)}px` }
      : undefined;

  return (
    <NodeViewWrapper
      as="div"
      className={
        selected
          ? "bn-visual-media-wrapper ProseMirror-selectednode"
          : "bn-visual-media-wrapper"
      }
      data-drag-handle
    >
      <img
        src={displaySrc || src}
        alt={alt}
        className="bn-visual-media"
        style={style}
        draggable={false}
      />
    </NodeViewWrapper>
  );
}

/** Image node: on-disk `src` stays vault-relative; display uses convertFileSrc. */
export const NoteImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      allowBase64: true,
      HTMLAttributes: {
        class: "bn-visual-media",
      },
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null as number | string | null,
        parseHTML: (element: HTMLElement) => {
          const attr = element.getAttribute("width");
          if (attr) {
            const n = Number(attr);
            return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
          }
          const styleW = element.style.width;
          if (styleW) {
            const n = Number(styleW.replace(/px$/i, ""));
            return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
          }
          return null;
        },
        renderHTML: (attributes: { width?: number | string | null }) => {
          const w = attributes.width;
          if (w == null || w === "") return {};
          const n = typeof w === "number" ? w : Number(String(w));
          if (!Number.isFinite(n) || n <= 0) return {};
          return {
            width: String(Math.round(n)),
            style: `width: ${Math.round(n)}px`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteImageView);
  },
});

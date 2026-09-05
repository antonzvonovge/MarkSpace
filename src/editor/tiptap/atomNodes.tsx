import { mergeAttributes, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import type { ReactElement } from "react";
import { AudioEmbedView } from "../audio/AudioEmbedBlock";
import { DEFAULT_DRAWIO_PREVIEW_WIDTH } from "../drawio/constants";
import { DrawioEmbedView } from "../drawio/DrawioEmbedBlock";
import { D2BlockView } from "../d2/D2Block";
import { DotBlockView } from "../dot/DotBlock";
import { MarkmapBlockView } from "../markmap/MarkmapBlock";
import { LatexInlineView } from "../math/LatexInline";
import { MathEquationView } from "../math/MathEquationBlock";
import { MermaidBlockView } from "../mermaid/MermaidBlock";
import { PlantUmlBlockView } from "../plantuml/PlantUMLBlock";
import {
  formatDrawioFenceBody,
  parseAudioFenceBody,
  parseDrawioFenceBody,
} from "../../lib/wikiMarkdown";

/** Prefer atom fence parsers over TipTap CodeBlock (default priority 100). */
const ATOM_PRIORITY = 150;

const PLANTUML_LANGS = new Set(["plantuml", "puml"]);
const DOT_LANGS = new Set(["dot", "graphviz"]);
const MATH_FENCE_LANGS = new Set(["math", "latex", "equation", "tex"]);

function codeLanguage(codeEl: Element): string | undefined {
  return (
    codeEl.getAttribute("data-language") ||
    codeEl.className
      .split(/\s+/)
      .find((name) => name.startsWith("language-"))
      ?.replace("language-", "")
  );
}

function parsePreCodeLanguage(
  element: HTMLElement,
): { language: string; text: string } | false {
  if (element.tagName !== "PRE") return false;
  if (
    element.childElementCount !== 1 ||
    element.firstElementChild?.tagName !== "CODE"
  ) {
    return false;
  }
  const codeEl = element.firstElementChild!;
  const language = codeLanguage(codeEl)?.toLowerCase();
  if (!language) return false;
  return { language, text: codeEl.textContent ?? "" };
}

function nodeId(
  attrs: Record<string, unknown>,
  getPos: ReactNodeViewProps["getPos"],
  prefix: string,
): string {
  const existing = attrs.id;
  if (typeof existing === "string" && existing) return existing;
  const pos = typeof getPos === "function" ? getPos() : undefined;
  return `${prefix}-${pos ?? "unknown"}`;
}

type BlockEditorLike = {
  isEditable: boolean;
  prosemirrorView?: import("@tiptap/pm/view").EditorView;
  domElement?: HTMLElement;
  updateBlock: (
    block: { id: string } | string,
    update: { props: Record<string, unknown> },
  ) => void;
  focus: () => void;
};

function adaptBlockEditor(
  editor: ReactNodeViewProps["editor"],
  updateAttributes: (attrs: Record<string, unknown>) => void,
): BlockEditorLike {
  return {
    isEditable: editor.isEditable,
    prosemirrorView: editor.view,
    domElement: editor.view.dom,
    updateBlock: (_block, update) => {
      updateAttributes(update.props);
    },
    focus: () => {
      editor.commands.focus();
    },
  };
}

type ExistingBlockView = (props: {
  block: { id: string; props: Record<string, unknown> };
  editor: BlockEditorLike;
}) => ReactElement;

function wrapAtomView(
  View: ExistingBlockView,
  prefix: string,
  propsFromAttrs: (attrs: Record<string, unknown>) => Record<string, unknown>,
) {
  return function AtomNodeView(props: ReactNodeViewProps) {
    const { node, updateAttributes, editor, getPos } = props;
    const attrs = node.attrs as Record<string, unknown>;
    const block = {
      id: nodeId(attrs, getPos, prefix),
      props: propsFromAttrs(attrs),
    };
    const adapted = adaptBlockEditor(editor, updateAttributes);
    return (
      <NodeViewWrapper
        as="div"
        data-type={node.type.name}
        className="bn-atom-node"
      >
        <View block={block} editor={adapted} />
      </NodeViewWrapper>
    );
  };
}

function asBlockView(view: unknown): ExistingBlockView {
  return view as ExistingBlockView;
}

function createCodeFenceAtom(opts: {
  name: string;
  languages: Set<string> | string;
  renderLanguage: string;
  View: unknown;
  defaultCode?: string;
}) {
  const languageSet =
    typeof opts.languages === "string"
      ? new Set([opts.languages])
      : opts.languages;

  return Node.create({
    name: opts.name,
    group: "block",
    atom: true,
    isolating: true,
    selectable: true,
    draggable: true,
    priority: ATOM_PRIORITY,
    addAttributes() {
      return {
        id: { default: null },
        code: { default: opts.defaultCode ?? "" },
      };
    },
    parseHTML() {
      return [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs: (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const parsed = parsePreCodeLanguage(el);
            if (!parsed || !languageSet.has(parsed.language)) return false;
            return { code: parsed.text };
          },
        },
      ];
    },
    renderHTML({ node }) {
      return [
        "pre",
        [
          "code",
          { "data-language": opts.renderLanguage },
          node.attrs.code ?? "",
        ],
      ];
    },
    addNodeView() {
      return ReactNodeViewRenderer(
        wrapAtomView(asBlockView(opts.View), opts.name, (attrs) => ({
          code: String(attrs.code ?? ""),
        })),
      );
    },
  });
}

export const Mermaid = createCodeFenceAtom({
  name: "mermaid",
  languages: "mermaid",
  renderLanguage: "mermaid",
  View: MermaidBlockView,
});

export const PlantUml = createCodeFenceAtom({
  name: "plantuml",
  languages: PLANTUML_LANGS,
  renderLanguage: "plantuml",
  View: PlantUmlBlockView,
});

export const D2 = createCodeFenceAtom({
  name: "d2",
  languages: "d2",
  renderLanguage: "d2",
  View: D2BlockView,
});

export const Dot = createCodeFenceAtom({
  name: "dot",
  languages: DOT_LANGS,
  renderLanguage: "dot",
  View: DotBlockView,
});

export const Markmap = createCodeFenceAtom({
  name: "markmap",
  languages: "markmap",
  renderLanguage: "markmap",
  View: MarkmapBlockView,
});

function parseDrawioElement(
  element: HTMLElement,
): { src: string; previewWidth: number } | false {
  if (element.tagName === "PRE") {
    const parsed = parsePreCodeLanguage(element);
    if (!parsed || parsed.language !== "drawio") return false;
    const body = parseDrawioFenceBody(parsed.text);
    if (!body?.src) return false;
    return {
      src: body.src,
      previewWidth: body.previewWidth ?? DEFAULT_DRAWIO_PREVIEW_WIDTH,
    };
  }

  if (element.tagName === "DIV") {
    const src = element.getAttribute("data-drawio-src");
    if (!src) return false;
    const widthRaw = element.getAttribute("data-preview-width");
    const previewWidth = widthRaw
      ? Number(widthRaw)
      : DEFAULT_DRAWIO_PREVIEW_WIDTH;
    return {
      src,
      previewWidth:
        Number.isFinite(previewWidth) && previewWidth > 0
          ? previewWidth
          : DEFAULT_DRAWIO_PREVIEW_WIDTH,
    };
  }

  return false;
}

export const Drawio = Node.create({
  name: "drawio",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  priority: ATOM_PRIORITY,
  addAttributes() {
    return {
      id: { default: null },
      src: { default: "" },
      previewWidth: { default: DEFAULT_DRAWIO_PREVIEW_WIDTH },
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return parseDrawioElement(el);
        },
      },
      {
        tag: "div[data-drawio-src]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return parseDrawioElement(el);
        },
      },
    ];
  },
  renderHTML({ node }) {
    const src = String(node.attrs.src ?? "");
    const previewWidth =
      Number(node.attrs.previewWidth) || DEFAULT_DRAWIO_PREVIEW_WIDTH;
    return [
      "pre",
      [
        "code",
        { "data-language": "drawio" },
        formatDrawioFenceBody(src, previewWidth),
      ],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(
      wrapAtomView(asBlockView(DrawioEmbedView), "drawio", (attrs) => ({
        src: String(attrs.src ?? ""),
        previewWidth:
          Number(attrs.previewWidth) || DEFAULT_DRAWIO_PREVIEW_WIDTH,
      })),
    );
  },
});

function parseAudioElement(element: HTMLElement): { src: string } | false {
  const parsed = parsePreCodeLanguage(element);
  if (!parsed || parsed.language !== "audio") return false;
  const src = parseAudioFenceBody(parsed.text);
  if (!src) return false;
  return { src };
}

export const Audio = Node.create({
  name: "audio",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  priority: ATOM_PRIORITY,
  addAttributes() {
    return {
      id: { default: null },
      src: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return parseAudioElement(el);
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "pre",
      ["code", { "data-language": "audio" }, String(node.attrs.src ?? "")],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(function AudioNodeView(
      props: ReactNodeViewProps,
    ) {
      const { node, editor, getPos } = props;
      const attrs = node.attrs as Record<string, unknown>;
      const block = {
        id: nodeId(attrs, getPos, "audio"),
        props: { src: String(attrs.src ?? "") },
      };
      const adapted = adaptBlockEditor(editor, () => {});
      return (
        <NodeViewWrapper as="div" data-type="audio" className="bn-atom-node">
          <AudioEmbedView block={block} editor={adapted} />
        </NodeViewWrapper>
      );
    });
  },
});

export const Equation = Node.create({
  name: "equation",
  group: "block",
  atom: true,
  isolating: true,
  selectable: true,
  draggable: true,
  priority: ATOM_PRIORITY,
  addAttributes() {
    return {
      id: { default: null },
      latex: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const parsed = parsePreCodeLanguage(el);
          if (!parsed || !MATH_FENCE_LANGS.has(parsed.language)) return false;
          return { latex: parsed.text };
        },
      },
      {
        tag: "div.bn-equation",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const latex =
            el.getAttribute("data-latex") ||
            el.querySelector("[data-latex]")?.getAttribute("data-latex");
          if (latex === null || latex === undefined) return false;
          return { latex };
        },
      },
      {
        tag: 'div[data-content-type="equation"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const latex =
            el.getAttribute("data-latex") ||
            el.querySelector("[data-latex]")?.getAttribute("data-latex");
          if (latex === null || latex === undefined) return false;
          return { latex };
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "pre",
      ["code", { "data-language": "math" }, String(node.attrs.latex ?? "")],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(
      wrapAtomView(asBlockView(MathEquationView), "equation", (attrs) => ({
        latex: String(attrs.latex ?? ""),
      })),
    );
  },
});

function LatexInlineNodeView(props: ReactNodeViewProps): ReactElement {
  const { node, updateAttributes, editor } = props;
  const latex = String(node.attrs.latex ?? "");
  return (
    <NodeViewWrapper as="span" data-type="latex" className="bn-latex-node">
      <LatexInlineView
        inlineContent={{ props: { latex } }}
        updateInlineContent={(update) => {
          updateAttributes({
            latex: update.props.latex,
            displayMode: update.props.displayMode,
          });
        }}
        editor={{
          isEditable: editor.isEditable,
          focus: () => {
            editor.commands.focus();
          },
        }}
      />
    </NodeViewWrapper>
  );
}

/** Inline TeX atom — mirrors BlockNote `latex` inline content. */
export const LatexInline = Node.create({
  name: "latex",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  priority: ATOM_PRIORITY,
  addAttributes() {
    return {
      latex: { default: "" },
      displayMode: { default: false },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-latex]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          if (el.tagName === "DIV" || el.tagName === "PRE") return false;
          if (
            el.classList.contains("bn-equation") ||
            el.getAttribute("data-content-type") === "equation"
          ) {
            return false;
          }
          const latex = el.getAttribute("data-latex");
          if (latex === null || latex === undefined) return false;
          return { latex, displayMode: false };
        },
      },
    ];
  },
  renderHTML({ node }) {
    const latex = String(node.attrs.latex ?? "");
    return [
      "span",
      mergeAttributes({
        "data-inline-content-type": "latex",
        "data-latex": latex,
      }),
      latex ? `$${latex}$` : "",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LatexInlineNodeView);
  },
});

/** All MarkSpace atom block + inline nodes for TipTap. */
export const noteAtomExtensions = [
  Mermaid,
  PlantUml,
  D2,
  Dot,
  Markmap,
  Drawio,
  Audio,
  Equation,
  LatexInline,
] as const;

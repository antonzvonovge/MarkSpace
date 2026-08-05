import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import katex from "katex";
import { useEffect, useState } from "react";
import { selectAtomBlockOnMouseDown } from "../selectAtomBlock";

export const DEFAULT_EQUATION_LATEX = "E = mc^2";

type ViewMode = "preview" | "edit";

function renderDisplayLatex(latex: string): string {
  return katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
    output: "htmlAndMathml",
  });
}

function MathEquationView(props: {
  block: { id: string; props: { latex: string } };
  editor: {
    isEditable: boolean;
    prosemirrorView?: import("prosemirror-view").EditorView;
    updateBlock: (
      block: { id: string } | string,
      update: { props: { latex: string } },
    ) => void;
  };
}) {
  const { block, editor } = props;
  const [mode, setMode] = useState<ViewMode>(
    block.props.latex ? "preview" : "edit",
  );
  const [draft, setDraft] = useState(block.props.latex);

  useEffect(() => {
    setDraft(block.props.latex);
  }, [block.props.latex]);

  const commitLatex = (next: string) => {
    setDraft(next);
    if (next !== block.props.latex) {
      editor.updateBlock(block, { props: { latex: next } });
    }
  };

  return (
    <div
      className="diagram-block math-equation-block"
      contentEditable={false}
      onMouseDown={(event) =>
        selectAtomBlockOnMouseDown(event, editor, block.id)
      }
    >
      <div className="diagram-block__toolbar">
        <span className="diagram-block__label">Equation</span>
        <div className="diagram-block__modes" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            className={
              mode === "preview"
                ? "diagram-block__mode is-active"
                : "diagram-block__mode"
            }
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "edit"}
            className={
              mode === "edit"
                ? "diagram-block__mode is-active"
                : "diagram-block__mode"
            }
            onClick={() => setMode("edit")}
            disabled={!editor.isEditable}
          >
            Edit
          </button>
        </div>
      </div>
      {mode === "edit" ? (
        <textarea
          className="diagram-block__editor"
          value={draft}
          spellCheck={false}
          disabled={!editor.isEditable}
          onChange={(e) => commitLatex(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder={DEFAULT_EQUATION_LATEX}
          rows={Math.min(8, Math.max(2, draft.split("\n").length + 1))}
        />
      ) : block.props.latex.trim() ? (
        <div
          className="math-equation-block__preview"
          dangerouslySetInnerHTML={{
            __html: renderDisplayLatex(block.props.latex),
          }}
        />
      ) : (
        <div className="diagram-block__empty">Empty equation — switch to Edit</div>
      )}
    </div>
  );
}

function codeLanguage(codeEl: Element): string | undefined {
  return (
    codeEl.getAttribute("data-language") ||
    codeEl.className
      .split(/\s+/)
      .find((name) => name.startsWith("language-"))
      ?.replace("language-", "")
  );
}

const MATH_FENCE_LANGS = new Set(["math", "latex", "equation", "tex"]);

export const createMathEquationBlock = createReactBlockSpec(
  {
    type: "equation",
    propSchema: {
      latex: {
        default: "",
      },
    },
    content: "none",
  },
  {
    meta: {
      isolating: true,
    },
    runsBefore: ["codeBlock"],
    parse: (element) => {
      if (element.tagName === "PRE") {
        if (
          element.childElementCount !== 1 ||
          element.firstElementChild?.tagName !== "CODE"
        ) {
          return undefined;
        }
        const codeEl = element.firstElementChild!;
        const language = codeLanguage(codeEl)?.toLowerCase();
        if (!language || !MATH_FENCE_LANGS.has(language)) return undefined;
        return { latex: codeEl.textContent ?? "" };
      }

      // Paste / legacy HTML from blocknote-math.
      if (
        element.tagName === "DIV" &&
        (element.classList.contains("bn-equation") ||
          element.getAttribute("data-content-type") === "equation")
      ) {
        const latex =
          element.getAttribute("data-latex") ||
          element.querySelector("[data-latex]")?.getAttribute("data-latex");
        if (latex !== null && latex !== undefined) return { latex };
      }
      return undefined;
    },
    toExternalHTML: ({ block }) => (
      <pre>
        <code data-language="math">{block.props.latex}</code>
      </pre>
    ),
    render: (props) => <MathEquationView {...props} />,
  },
  [
    createExtension({
      key: "math-equation-input-rule",
      runsBefore: ["code-block-keyboard-shortcuts"],
      inputRules: [
        {
          find: /^```math\s$/,
          replace: () => ({
            type: "equation",
            props: { latex: DEFAULT_EQUATION_LATEX },
          }),
        },
      ],
    }),
  ],
);

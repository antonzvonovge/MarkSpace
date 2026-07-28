import { createExtension } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useRef, useState } from "react";
import { usePrefsStore } from "../../store/prefsStore";
import { scheduleDiagramPreview } from "../scheduleDiagramPreview";
import { selectAtomBlockOnMouseDown } from "../selectAtomBlock";
import { renderPlantUmlToSvg } from "./renderPlantUml";

export const DEFAULT_PLANTUML_CODE = `@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi
@enduml`;

const PLANTUML_LANGS = new Set(["plantuml", "puml"]);

type ViewMode = "preview" | "edit";

function PlantUmlPreview({ code, dark }: { code: string; dark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return scheduleDiagramPreview({
      engine: "plantuml",
      code,
      dark,
      render: renderPlantUmlToSvg,
      onUpdate: ({ svg, error: nextError, pending: nextPending }) => {
        setError(nextError);
        setPending(nextPending);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg ?? "";
        }
      },
    });
  }, [code, dark]);

  if (!code.trim()) {
    return (
      <div className="diagram-block__empty">Empty diagram — switch to Edit</div>
    );
  }

  return (
    <div className="diagram-block__preview">
      {pending ? <div className="diagram-block__pending">Rendering…</div> : null}
      {error ? <div className="diagram-block__error">{error}</div> : null}
      <div
        ref={containerRef}
        className="diagram-block__svg"
        hidden={Boolean(error)}
      />
    </div>
  );
}

function PlantUmlBlockView(props: {
  block: { id: string; props: { code: string } };
  editor: {
    isEditable: boolean;
    prosemirrorView?: import("prosemirror-view").EditorView;
    updateBlock: (
      block: { id: string } | string,
      update: { props: { code: string } },
    ) => void;
  };
}) {
  const { block, editor } = props;
  const theme = usePrefsStore((s) => s.prefs.theme);
  const dark = theme === "dark";
  const [mode, setMode] = useState<ViewMode>("preview");
  const [draft, setDraft] = useState(block.props.code);

  useEffect(() => {
    setDraft(block.props.code);
  }, [block.props.code]);

  const commitCode = (next: string) => {
    setDraft(next);
    if (next !== block.props.code) {
      editor.updateBlock(block, { props: { code: next } });
    }
  };

  return (
    <div
      className="diagram-block"
      contentEditable={false}
      onMouseDown={(event) =>
        selectAtomBlockOnMouseDown(event, editor, block.id)
      }
    >
      <div className="diagram-block__toolbar">
        <span className="diagram-block__label">PlantUML</span>
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
          onChange={(e) => commitCode(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder={DEFAULT_PLANTUML_CODE}
          rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
        />
      ) : (
        <PlantUmlPreview code={block.props.code} dark={dark} />
      )}
    </div>
  );
}

export const createPlantUmlBlock = createReactBlockSpec(
  {
    type: "plantuml",
    propSchema: {
      code: {
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
      if (element.tagName !== "PRE") return undefined;
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
      if (!language || !PLANTUML_LANGS.has(language.toLowerCase())) {
        return undefined;
      }
      return { code: codeEl.textContent ?? "" };
    },
    toExternalHTML: ({ block }) => (
      <pre>
        <code data-language="plantuml">{block.props.code}</code>
      </pre>
    ),
    render: (props) => <PlantUmlBlockView {...props} />,
  },
  [
    createExtension({
      key: "plantuml-input-rule",
      runsBefore: ["code-block-keyboard-shortcuts"],
      inputRules: [
        {
          find: /^```(?:plantuml|puml)\s$/,
          replace: () => ({
            type: "plantuml",
            props: { code: DEFAULT_PLANTUML_CODE },
          }),
        },
      ],
    }),
  ],
);

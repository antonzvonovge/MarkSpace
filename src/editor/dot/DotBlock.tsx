import { useEffect, useRef, useState } from "react";
import {
  DiagramExpandIcon,
  DiagramLightbox,
} from "../../components/DiagramLightbox";
import { usePrefsStore } from "../../store/prefsStore";
import { scheduleDiagramPreview } from "../scheduleDiagramPreview";
import { selectAtomBlockOnMouseDown } from "../selectAtomBlock";
import { renderDotToSvg } from "./renderDot";

export const DEFAULT_DOT_CODE = `digraph {
  rankdir=TB
  A [label="Start"]
  B [label="End"]
  A -> B
}`;

type ViewMode = "preview" | "edit";

function DotPreview({ code, dark }: { code: string; dark: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    return scheduleDiagramPreview({
      engine: "dot",
      code,
      dark,
      render: renderDotToSvg,
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

export function DotBlockView(props: {
  block: { id: string; props: { code: string } };
  editor: {
    isEditable: boolean;
    prosemirrorView?: import("@tiptap/pm/view").EditorView;
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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const canExpand = Boolean(block.props.code.trim());

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
        <span className="diagram-block__label">DOT</span>
        <div className="diagram-block__toolbar-end">
          <button
            type="button"
            className="diagram-block__expand"
            aria-label="Open diagram fullscreen"
            title="Open fullscreen"
            disabled={!canExpand}
            onClick={() => setLightboxOpen(true)}
          >
            <DiagramExpandIcon />
          </button>
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
          placeholder={DEFAULT_DOT_CODE}
          rows={Math.min(16, Math.max(4, draft.split("\n").length + 1))}
        />
      ) : (
        <DotPreview code={block.props.code} dark={dark} />
      )}
      <DiagramLightbox
        open={lightboxOpen}
        engine="dot"
        code={block.props.code}
        title="DOT"
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}


import katex from "katex";
import { useEffect, useRef, useState } from "react";

function renderInlineLatex(latex: string): string {
  return katex.renderToString(latex, {
    displayMode: false,
    throwOnError: false,
    output: "htmlAndMathml",
  });
}

export function LatexInlineView(props: {
  inlineContent: { props: { latex: string } };
  updateInlineContent: (update: {
    type: "latex";
    props: { latex: string; displayMode: boolean };
  }) => void;
  editor: { focus: () => void; isEditable: boolean };
}) {
  const { inlineContent, updateInlineContent, editor } = props;
  const latex = inlineContent.props.latex;
  const [editing, setEditing] = useState(!latex);
  const [draft, setDraft] = useState(latex);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(latex);
  }, [editing, latex]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = () => {
    const next = draft.trim();
    if (!next) {
      inputRef.current?.focus();
      return;
    }
    updateInlineContent({
      type: "latex",
      props: { latex: next, displayMode: false },
    });
    setEditing(false);
    editor.focus();
  };

  const cancel = () => {
    setDraft(latex);
    setEditing(false);
    editor.focus();
  };

  if (editing && editor.isEditable) {
    return (
      <span className="bn-latex bn-latex-editing" contentEditable={false}>
        <input
          ref={inputRef}
          className="bn-latex-input"
          aria-label="LaTeX"
          value={draft}
          placeholder="e.g. E = mc^2"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
      </span>
    );
  }

  return (
    <span
      className="bn-latex"
      contentEditable={false}
      role="button"
      tabIndex={0}
      data-latex={latex}
      aria-label={latex ? `Edit inline equation: ${latex}` : "Add inline equation"}
      onClick={() => {
        if (editor.isEditable) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (editor.isEditable) setEditing(true);
        }
      }}
    >
      {latex ? (
        <span
          className="bn-latex-rendered"
          dangerouslySetInnerHTML={{ __html: renderInlineLatex(latex) }}
        />
      ) : (
        <span className="bn-latex-placeholder" aria-hidden="true">
          ∑
        </span>
      )}
    </span>
  );
}


import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  HighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

/** Markers like *, **, #, `, [], > — distinct from body text */
const markdownHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, color: "var(--text)", fontWeight: "700", fontSize: "1.25em" },
  { tag: t.heading2, color: "var(--text)", fontWeight: "700", fontSize: "1.15em" },
  { tag: t.heading3, color: "var(--text)", fontWeight: "650", fontSize: "1.08em" },
  { tag: t.heading4, color: "var(--text)", fontWeight: "650" },
  { tag: t.heading5, color: "var(--text)", fontWeight: "600" },
  { tag: t.heading6, color: "var(--text)", fontWeight: "600" },
  { tag: t.heading, color: "var(--text)", fontWeight: "650" },
  { tag: t.strong, color: "var(--text)", fontWeight: "700" },
  { tag: t.emphasis, color: "var(--text)", fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.monospace, color: "var(--accent-strong)", backgroundColor: "rgba(203, 17, 171, 0.06)" },
  { tag: t.link, color: "var(--accent-wb)", textDecoration: "underline" },
  { tag: t.url, color: "#7a5a9a" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.list, color: "var(--text)" },
  { tag: t.contentSeparator, color: "var(--muted)" },
  { tag: t.meta, color: "var(--muted)" },
  {
    tag: t.processingInstruction,
    color: "var(--accent-wb)",
    fontWeight: "600",
  },
  { tag: t.atom, color: "var(--accent-wb)" },
  { tag: t.bool, color: "var(--accent-wb)" },
  { tag: t.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.keyword, color: "var(--accent-strong)" },
  { tag: t.string, color: "#2f6f8f" },
  { tag: t.number, color: "#b86a2f" },
  { tag: t.operator, color: "var(--muted)" },
  { tag: t.punctuation, color: "var(--muted)" },
  { tag: t.name, color: "#2f6f8f" },
  { tag: t.variableName, color: "var(--text)" },
  { tag: t.typeName, color: "#6b4f8f" },
  { tag: t.propertyName, color: "#2f6f8f" },
  { tag: t.invalid, color: "var(--danger)" },
]);

const markspaceTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--source-font-size)",
    fontFamily: "var(--font-source)",
    backgroundColor: "var(--editor-gutter)",
    color: "var(--text)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "inherit",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "16px 12px 64px 12px",
    caretColor: "var(--accent-wb)",
    fontFamily: "inherit",
    fontVariantLigatures: "common-ligatures",
    fontFeatureSettings: '"liga" 1, "calt" 1',
  },
  ".cm-gutters": {
    backgroundColor: "var(--editor-gutter)",
    color: "var(--muted)",
    borderRight: "1px solid var(--line)",
    borderLeft: "none",
    margin: "0",
    fontFamily: "inherit",
    fontSize: "0.85em",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 16px",
    minWidth: "2.75rem",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(203, 17, 171, 0.06)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(203, 17, 171, 0.04)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent-wb)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(203, 17, 171, 0.14) !important",
  },
});

export function MarkdownSourceEditor({ path, content, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const lastExternalRef = useRef(content);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        markdown(),
        syntaxHighlighting(markdownHighlightStyle),
        markspaceTheme,
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Ctrl/Cmd+Z/Y by physical key so undo works on Russian layout.
        Prec.highest(
          EditorView.domEventHandlers({
            keydown(event, view) {
              if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
              if (/^[a-z]$/i.test(event.key)) return false;
              if (event.code === "KeyZ" && !event.shiftKey) {
                event.preventDefault();
                return undo(view);
              }
              if (
                (event.code === "KeyZ" && event.shiftKey) ||
                (event.code === "KeyY" && !event.shiftKey)
              ) {
                event.preventDefault();
                return redo(view);
              }
              return false;
            },
          }),
        ),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingRef.current) return;
          const next = update.state.doc.toString();
          lastExternalRef.current = next;
          onChange(next);
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    lastPathRef.current = path;
    lastExternalRef.current = content;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate editor only on note switch
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const pathChanged = lastPathRef.current !== path;
    const externalChange = content !== lastExternalRef.current;
    if (!pathChanged && !externalChange) return;

    applyingRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
    lastPathRef.current = path;
    lastExternalRef.current = content;
    applyingRef.current = false;
  }, [path, content]);

  return (
    <div className="source-editor-shell">
      <div className="source-editor-canvas" ref={containerRef} />
    </div>
  );
}

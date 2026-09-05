import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { usePersistedEditorScroll } from "../hooks/usePersistedEditorScroll";
import { registerSourceEditor } from "./completedTasksCommand";
import { refreshDocumentFindIfOpen } from "./find/documentFindController";
import { sourceFindField } from "./find/sourceFind";

type Props = {
  path: string;
  content: string;
  onChange: (markdown: string) => void;
};

/** Plain-text source view for .md notes (no language / highlighting). */
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
    backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in srgb, var(--accent) 4%, transparent)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent-wb)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent) !important",
  },
});

export function MarkdownSourceEditor({ path, content, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const lastExternalRef = useRef(content);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  usePersistedEditorScroll(scrollEl, path, "source");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        markspaceTheme,
        sourceFindField,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "false" }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        // Ctrl/Cmd+Z/Y by physical key so undo works on Russian layout.
        Prec.highest(
          EditorView.domEventHandlers({
            keydown(event, view) {
              if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
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
          if (update.docChanged && !applyingRef.current) {
            const next = update.state.doc.toString();
            if (next !== lastExternalRef.current) {
              lastExternalRef.current = next;
              onChange(next);
            }
          }
          if (update.docChanged) refreshDocumentFindIfOpen();
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    setScrollEl(view.scrollDOM);
    lastPathRef.current = path;
    lastExternalRef.current = content;
    const unregister = registerSourceEditor(path, view);
    refreshDocumentFindIfOpen();

    return () => {
      unregister();
      setScrollEl(null);
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

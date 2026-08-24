import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { usePersistedEditorScroll } from "../hooks/usePersistedEditorScroll";
import {
  EditContextMenu,
  type EditContextMenuState,
} from "../components/EditContextMenu";
import { writeClipboardText } from "../lib/clipboardText";
import { readTextFromSystemClipboard } from "./pasteImages";

type Props = {
  path: string;
  content: string;
  onChange: (text: string) => void;
};

const plainTheme = EditorView.theme({
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

function selectedText(view: EditorView): string {
  const { from, to } = view.state.selection.main;
  if (from === to) return "";
  return view.state.sliceDoc(from, to);
}

/** Plain-text CodeMirror source view (no Markdown language). */
export function PlainSourceEditor({ path, content, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const lastExternalRef = useRef(content);
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<EditContextMenuState | null>(
    null,
  );
  usePersistedEditorScroll(scrollEl, path, "source");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        history(),
        plainTheme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: "false" }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
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
          if (!update.docChanged || applyingRef.current) return;
          const next = update.state.doc.toString();
          if (next === lastExternalRef.current) return;
          lastExternalRef.current = next;
          onChange(next);
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    setScrollEl(view.scrollDOM);
    lastPathRef.current = path;
    lastExternalRef.current = content;

    return () => {
      setScrollEl(null);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recreate only on path switch
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

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const view = viewRef.current;
      const selected = view ? selectedText(view) : "";
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        canCut: selected.length > 0,
        canCopy: selected.length > 0,
        canPaste: true,
      });
    },
    [],
  );

  const cutSelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const text = view.state.sliceDoc(from, to);
    await writeClipboardText(text);
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
    });
    view.focus();
  }, []);

  const copySelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const text = selectedText(view);
    if (!text) return;
    await writeClipboardText(text);
  }, []);

  const pasteAtCursor = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const text = await readTextFromSystemClipboard();
    if (!text) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    view.focus();
  }, []);

  return (
    <div className="source-editor-shell" onContextMenu={openContextMenu}>
      <div className="source-editor-canvas" ref={containerRef} />
      {contextMenu ? (
        <EditContextMenu
          menu={contextMenu}
          onClose={closeContextMenu}
          onCut={() => void cutSelection()}
          onCopy={() => void copySelection()}
          onPaste={() => void pasteAtCursor()}
        />
      ) : null}
    </div>
  );
}

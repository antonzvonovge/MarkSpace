import type { EditorView } from "@codemirror/view";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  collectCompletedTaskIds,
  removeCompletedTaskLines,
  type TaskBlockLike,
} from "../lib/completedTasks";
import { documentKind } from "../lib/vaultApi";
import { useVaultStore } from "../store/vaultStore";
import type { NoteEditor } from "./schema";

type AnyEditor = BlockNoteEditor<any, any, any>;

const liveEditors = new Map<string, NoteEditor>();
const sourceEditors = new Map<string, EditorView>();

/** Register a Live BlockNote instance so palette commands can reach it. */
export function registerLiveEditor(path: string, editor: NoteEditor): () => void {
  liveEditors.set(path, editor);
  return () => {
    if (liveEditors.get(path) === editor) liveEditors.delete(path);
  };
}

/** Register a Source CodeMirror instance so palette commands can reach it. */
export function registerSourceEditor(
  path: string,
  view: EditorView,
): () => void {
  sourceEditors.set(path, view);
  return () => {
    if (sourceEditors.get(path) === view) sourceEditors.delete(path);
  };
}

export function getLiveEditor(path: string): NoteEditor | undefined {
  return liveEditors.get(path);
}

export function getSourceEditor(path: string): EditorView | undefined {
  return sourceEditors.get(path);
}

export function forEachLiveEditor(
  fn: (path: string, editor: NoteEditor) => void,
): void {
  for (const [path, editor] of liveEditors) fn(path, editor);
}

export function forEachSourceEditor(
  fn: (path: string, view: EditorView) => void,
): void {
  for (const [path, view] of sourceEditors) fn(path, view);
}

export function deleteCompletedTasksFromLiveEditor(editor: AnyEditor): number {
  if (!editor.isEditable) return 0;
  const selection = editor.getSelection();
  const roots = (selection?.blocks ?? editor.document) as TaskBlockLike[];
  const ids = collectCompletedTaskIds(roots);
  if (ids.length === 0) return 0;

  const idSet = new Set(ids);
  const removingAllTop =
    editor.document.length > 0 &&
    editor.document.every((block) => idSet.has(block.id));

  if (removingAllTop) {
    editor.replaceBlocks(editor.document, [{ type: "paragraph" }]);
  } else {
    editor.removeBlocks(ids);
  }
  return ids.length;
}

export function deleteCompletedTasksFromSourceEditor(view: EditorView): number {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const range = from === to ? undefined : { from, to };
  const { next, removed } = removeCompletedTaskLines(doc, range);
  if (removed === 0 || next === doc) return 0;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next },
    selection: { anchor: Math.min(from, next.length) },
  });
  return removed;
}

function focusSoon(focus: () => void) {
  window.requestAnimationFrame(() => {
    try {
      focus();
    } catch {
      /* editor may have unmounted */
    }
  });
}

export function canInsertTextInActiveMarkdown(): boolean {
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath || documentKind(activePath) !== "markdown") return false;
  if (viewMode === "source") return sourceEditors.has(activePath);
  const editor = liveEditors.get(activePath);
  return Boolean(editor?.isEditable);
}

/** Selected text in the active markdown editor, or empty. */
export function getActiveMarkdownSelection(): string {
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath || documentKind(activePath) !== "markdown") return "";
  if (viewMode === "source") {
    const view = sourceEditors.get(activePath);
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    if (from === to) return "";
    return view.state.sliceDoc(from, to);
  }
  const editor = liveEditors.get(activePath);
  if (!editor) return "";
  return editor.getSelectedText() ?? "";
}

/** Insert (or replace the selection) in the active markdown editor. */
export function insertTextInActiveMarkdown(text: string): boolean {
  if (!text) return false;
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath || documentKind(activePath) !== "markdown") return false;

  if (viewMode === "source") {
    const view = sourceEditors.get(activePath);
    if (!view) return false;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    focusSoon(() => view.focus());
    return true;
  }

  const editor = liveEditors.get(activePath);
  if (!editor || !editor.isEditable) return false;
  editor.pasteText(text);
  focusSoon(() => editor.focus());
  return true;
}

/** Restore caret in the active markdown editor without moving the selection. */
export function focusActiveMarkdownEditor(): boolean {
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath || documentKind(activePath) !== "markdown") return false;

  if (viewMode === "source") {
    const view = sourceEditors.get(activePath);
    if (!view) return false;
    focusSoon(() => view.focus());
    return true;
  }

  const editor = liveEditors.get(activePath);
  if (!editor) return false;
  focusSoon(() => editor.focus());
  return true;
}

/**
 * Delete completed checkbox blocks in the active markdown editor.
 * Range selection → only items in that selection; otherwise the whole note.
 */
export function deleteCompletedTasksInActiveEditor(): number {
  const { activePath, viewMode } = useVaultStore.getState();
  if (!activePath || documentKind(activePath) !== "markdown") return 0;

  if (viewMode === "source") {
    const view = sourceEditors.get(activePath);
    if (!view) return 0;
    const removed = deleteCompletedTasksFromSourceEditor(view);
    if (removed > 0) focusSoon(() => view.focus());
    return removed;
  }

  const editor = liveEditors.get(activePath);
  if (!editor) return 0;
  const removed = deleteCompletedTasksFromLiveEditor(editor);
  if (removed > 0) focusSoon(() => editor.focus());
  return removed;
}

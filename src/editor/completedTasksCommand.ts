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

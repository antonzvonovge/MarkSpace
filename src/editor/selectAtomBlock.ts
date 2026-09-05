import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { MouseEvent as ReactMouseEvent } from "react";

type EditorLike = {
  prosemirrorView?: EditorView;
};

/** Native controls / resize handles — leave their events alone. */
export function isDiagramInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, textarea, input, select, a, .bn-resize-handle, [contenteditable='true'], [role='slider']",
    ),
  );
}

/**
 * Force a NodeSelection on the atom node and focus the editor.
 * Clicks inside `contentEditable={false}` diagram chrome often fail to create
 * the selection frame without this.
 */
export function selectAtomBlockOnMouseDown(
  event: ReactMouseEvent,
  editor: EditorLike,
  blockId: string,
): void {
  if (isDiagramInteractiveTarget(event.target)) return;

  const view = editor.prosemirrorView;
  if (!view) return;

  let foundPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (node.attrs?.id === blockId) {
      foundPos = pos;
      return false;
    }
    return true;
  });
  if (foundPos == null) return;

  try {
    const selection = NodeSelection.create(view.state.doc, foundPos);
    if (!view.state.selection.eq(selection)) {
      view.dispatch(view.state.tr.setSelection(selection));
    }
    view.focus();
  } catch {
    /* node may not allow NodeSelection */
  }
}

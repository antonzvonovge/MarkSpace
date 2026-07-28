import { getBlockInfo, getNodeById } from "@blocknote/core";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { MouseEvent as ReactMouseEvent } from "react";

type EditorLike = {
  prosemirrorView?: EditorView;
};

/** Native controls / resize handles — leave their events alone. */
export function isDiagramInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "button, textarea, input, select, a, .bn-resize-handle, [contenteditable='true']",
    ),
  );
}

/**
 * Force a NodeSelection on the block's atom content node and focus the editor.
 * Needed after BlockNote's `blockDragEnd` blurs the editor: clicks inside
 * `contentEditable={false}` diagram chrome often fail to create the blue frame.
 */
export function selectAtomBlockOnMouseDown(
  event: ReactMouseEvent,
  editor: EditorLike,
  blockId: string,
): void {
  if (isDiagramInteractiveTarget(event.target)) return;

  const view = editor.prosemirrorView;
  if (!view) return;

  const posInfo = getNodeById(blockId, view.state.doc);
  if (!posInfo) return;

  const blockInfo = getBlockInfo(posInfo);
  if (!blockInfo.isBlockContainer) return;

  const contentPos = blockInfo.blockContent.beforePos;
  const selection = NodeSelection.create(view.state.doc, contentPos);
  if (!view.state.selection.eq(selection)) {
    view.dispatch(view.state.tr.setSelection(selection));
  }
  view.focus();
}

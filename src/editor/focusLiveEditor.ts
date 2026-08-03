import type { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";

type AnyEditor = BlockNoteEditor<any, any, any>;

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  ".bn-side-menu",
  ".bn-resize-handle",
  ".bn-trailing-block",
  ".bn-suggestion-menu",
  ".bn-block-content",
  ".bn-inline-content",
  ".page-tags-chips",
  ".mantine-Menu-dropdown",
  ".mantine-Menu-item",
].join(", ");

function isEmptyTextBlock(block: {
  content?: unknown;
  type: string;
}): boolean {
  if (block.type !== "paragraph") return false;
  if (!Array.isArray(block.content)) return false;
  if (block.content.length === 0) return true;
  if (
    block.content.length === 1 &&
    typeof block.content[0] === "object" &&
    block.content[0] &&
    "type" in block.content[0] &&
    (block.content[0] as { type: string }).type === "text" &&
    "text" in block.content[0] &&
    !(block.content[0] as { text: string }).text
  ) {
    return true;
  }
  return false;
}

/** True when the click is on chrome / empty padding, not real block content. */
export function isEmptyLiveEditorClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE_SELECTOR)) return false;
  return Boolean(
    target.closest(".editor-main, .editor-canvas, .bn-container, .bn-editor"),
  );
}

function placeCaretAtDocumentEnd(editor: AnyEditor): void {
  const doc = editor.document;
  let last = doc[doc.length - 1];
  if (!last) {
    editor.replaceBlocks(doc, [{ type: "paragraph" }]);
    last = editor.document[0];
    if (!last) return;
  }

  // Atom / non-text last block: append an empty paragraph to type into.
  if (!Array.isArray(last.content)) {
    const [inserted] = editor.insertBlocks(
      [{ type: "paragraph" }],
      last,
      "after",
    );
    if (inserted) editor.setTextCursorPosition(inserted, "start");
    return;
  }

  editor.setTextCursorPosition(
    last,
    isEmptyTextBlock(last) ? "start" : "end",
  );
}

/**
 * Focus the Live editor after a click on empty canvas / gutters / padding.
 * Prefer ProseMirror's nearest position when available; otherwise caret at end.
 * Returns true when the event was handled (caller should preventDefault).
 */
export function focusLiveEditorFromEmptyClick(
  editor: AnyEditor,
  event: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  },
): boolean {
  if (!isEmptyLiveEditorClick(event.target)) return false;

  const view = editor.prosemirrorView;
  if (!view) return false;

  const coords = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  if (coords) {
    try {
      const $pos = view.state.doc.resolve(coords.pos);
      const sel = TextSelection.near($pos);
      if (!view.state.selection.eq(sel)) {
        view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
      }
      view.focus();
      return true;
    } catch {
      // Fall through to BlockNote end placement.
    }
  }

  placeCaretAtDocumentEnd(editor);
  editor.focus();
  return true;
}

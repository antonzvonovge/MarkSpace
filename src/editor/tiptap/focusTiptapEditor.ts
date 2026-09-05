/**
 * Focus the TipTap Live editor after a click on empty canvas / gutters.
 * Clicks inside document content must not call preventDefault — that blocks
 * native text selection.
 */

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

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
  ".page-tags-chips",
  ".bn-atom-node",
  ".bn-visual-media-wrapper",
  ".diagram-block",
].join(", ");

/**
 * True when the click is on chrome / empty padding below the doc, not on
 * ProseMirror content (paragraphs, headings, lists, …).
 */
export function isEmptyTiptapEditorClick(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(INTERACTIVE_SELECTOR)) return false;

  // TipTap content is plain HTML inside `.ProseMirror` — any descendant is
  // real content. Only the root `.ProseMirror` / `.bn-editor` itself (empty
  // padding) should trigger caret placement.
  const pm = target.closest(".ProseMirror");
  if (pm && target !== pm) return false;

  return Boolean(
    target.closest(".editor-main, .editor-canvas, .bn-container, .bn-editor"),
  );
}

export function focusTiptapEditorFromEmptyClick(
  editor: Editor,
  event: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  },
): boolean {
  if (!isEmptyTiptapEditorClick(event.target)) return false;

  const view = editor.view;
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
      /* fall through */
    }
  }

  const end = view.state.doc.content.size;
  try {
    const sel = TextSelection.near(view.state.doc.resolve(end), -1);
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  } catch {
    /* empty doc */
  }
  view.focus();
  return true;
}

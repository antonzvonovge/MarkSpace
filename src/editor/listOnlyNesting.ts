import { Extension } from "@tiptap/core";
import type { BlockNoteEditor } from "@blocknote/core";

/** Block types whose children markdown can express as indented content. */
const LIST_ITEM_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "toggleListItem",
]);

/** Blocks that bind Tab themselves (cell navigation / code indent). */
const OWN_TAB_TYPES = new Set(["table", "codeBlock"]);

/**
 * Tab nests a block under its previous sibling. Markdown can only carry that
 * indent when the sibling is a list item, so nesting under a paragraph or
 * heading would vanish on the next save. Swallow Tab there instead of showing
 * an indent the file cannot keep.
 */
export function createListOnlyNestingExtension(
  getEditor: () => BlockNoteEditor<any, any, any> | null,
) {
  return Extension.create({
    name: "listOnlyNesting",
    // Above BlockNote's keyboard shortcuts (priority 50) so this runs first.
    priority: 200,
    addKeyboardShortcuts() {
      return {
        Tab: () => {
          const editor = getEditor();
          if (!editor) return false;

          const position = editor.getTextCursorPosition();
          if (!position?.block) return false;
          if (OWN_TAB_TYPES.has(position.block.type)) return false;

          const parent = position.prevBlock;
          if (parent && LIST_ITEM_TYPES.has(parent.type)) return false;

          // Swallow: returning true also keeps focus from leaving the editor.
          return true;
        },
      };
    },
  });
}

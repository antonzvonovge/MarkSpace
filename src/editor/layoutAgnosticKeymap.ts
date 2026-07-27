import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import type { BlockNoteEditor } from "@blocknote/core";
import { pasteImagesFromSystemClipboard } from "./pasteImages";

/**
 * ProseMirror/TipTap bind Mod-z to event.key, which becomes "я" on a Russian
 * layout. Handle physical keys via event.code so Ctrl/Cmd shortcuts work
 * regardless of input language. Also force-image paste on Ctrl+V when the
 * DOM paste event doesn't carry image files (common in Tauri/Linux).
 */
export function createLayoutAgnosticKeymapExtension(
  getEditor: () => BlockNoteEditor<any, any, any> | null,
) {
  return Extension.create({
    name: "layoutAgnosticKeymap",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(_view, event) {
              if (!(event.ctrlKey || event.metaKey) || event.altKey) {
                return false;
              }

              const editor = getEditor();
              if (!editor) return false;

              const code = event.code;
              const latin = /^[a-z]$/i.test(event.key);

              // Image paste via physical V when layout is non-Latin (paste
              // event may not fire). Latin layouts keep the native paste path.
              if (code === "KeyV" && !event.shiftKey) {
                if (!latin) {
                  event.preventDefault();
                  void pasteImagesFromSystemClipboard(editor);
                  return true;
                }
                return false;
              }

              if (latin) return false;

              if (code === "KeyZ" && !event.shiftKey) {
                editor.undo();
                return true;
              }
              if (code === "KeyZ" && event.shiftKey) {
                editor.redo();
                return true;
              }
              if (code === "KeyY" && !event.shiftKey) {
                editor.redo();
                return true;
              }
              if (code === "KeyB" && !event.shiftKey) {
                editor.toggleStyles({ bold: true });
                return true;
              }
              if (code === "KeyI" && !event.shiftKey) {
                editor.toggleStyles({ italic: true });
                return true;
              }
              if (code === "KeyU" && !event.shiftKey) {
                editor.toggleStyles({ underline: true });
                return true;
              }

              return false;
            },
          },
        }),
      ];
    },
  });
}

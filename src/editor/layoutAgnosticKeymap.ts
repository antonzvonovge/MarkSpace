import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import type { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import {
  markPasteGestureHandled,
  pasteImagesFromSystemClipboard,
  readTextFromSystemClipboard,
  warnClipboardImageMissing,
} from "./pasteImages";

/**
 * ProseMirror/TipTap bind Mod-z to event.key, which becomes "я" on a Russian
 * layout. Handle physical keys via event.code so Ctrl/Cmd shortcuts work
 * regardless of input language.
 *
 * For Ctrl+V on non-Latin layouts: take over paste — try system clipboard
 * images (Tauri + navigator), then fall back to clipboard text so we don't
 * swallow normal paste entirely when there is no image.
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

              // Physical-key undo/redo must run before the latin early-return —
              // TipTap binds Mod-z to event.key ("я" on Russian), so it never fires.
              if (code === "KeyZ" && !event.shiftKey) {
                event.preventDefault();
                editor.undo();
                return true;
              }
              if (code === "KeyZ" && event.shiftKey) {
                event.preventDefault();
                editor.redo();
                return true;
              }
              if (code === "KeyY" && !event.shiftKey) {
                event.preventDefault();
                editor.redo();
                return true;
              }

              // Same slash menu as typing `/` (Ctrl/Cmd+Space).
              if (code === "Space" && !event.shiftKey) {
                event.preventDefault();
                const suggestionMenu = editor.getExtension(SuggestionMenu);
                if (!suggestionMenu || suggestionMenu.shown()) return true;
                suggestionMenu.openSuggestionMenu("/");
                return true;
              }

              if (code === "KeyV" && !event.shiftKey) {
                if (latin) return false;

                event.preventDefault();
                markPasteGestureHandled();
                void (async () => {
                  if (await pasteImagesFromSystemClipboard(editor)) return;
                  const text = await readTextFromSystemClipboard();
                  if (text) {
                    editor.pasteText(text);
                    return;
                  }
                  // Neither image nor text: the clipboard owner served the
                  // image lazily, so give the read a couple more tries.
                  if (await pasteImagesFromSystemClipboard(editor, 2)) return;
                  warnClipboardImageMissing("Ctrl+V");
                })();
                return true;
              }

              if (latin) return false;

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

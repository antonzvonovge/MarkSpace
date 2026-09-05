/**
 * Layout-agnostic Mod shortcuts for TipTap (physical `event.code`).
 * BlockNote's version talks to BN APIs; this one uses TipTap `Editor` directly.
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  markPasteGestureHandled,
  readImagesFromSystemClipboard,
  readTextFromSystemClipboard,
  warnClipboardImageMissing,
} from "../pasteImages";
import { writeAsset } from "../../lib/vaultApi";

async function pasteImagesIntoTiptap(
  editor: Editor,
  notePath: string,
  retries = 0,
): Promise<boolean> {
  const files = await readImagesFromSystemClipboard(retries);
  if (files.length === 0) return false;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name?.trim() || "clipboard.png";
    const url = await writeAsset(notePath, name, bytes);
    editor
      .chain()
      .focus()
      .insertContent({ type: "image", attrs: { src: url, alt: "" } })
      .run();
  }
  return true;
}

export function createTiptapLayoutAgnosticKeymap(opts: {
  getEditor: () => Editor | null;
  getNotePath: () => string;
}) {
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

              const editor = opts.getEditor();
              if (!editor) return false;

              const code = event.code;
              const latin = /^[a-z]$/i.test(event.key);

              if (code === "KeyZ" && !event.shiftKey) {
                event.preventDefault();
                editor.commands.undo();
                return true;
              }
              if (code === "KeyZ" && event.shiftKey) {
                event.preventDefault();
                editor.commands.redo();
                return true;
              }
              if (code === "KeyY" && !event.shiftKey) {
                event.preventDefault();
                editor.commands.redo();
                return true;
              }

              // Same insert palette as `/` (Ctrl/Cmd+Space), without inserting `/`.
              if (code === "Space" && !event.shiftKey) {
                event.preventDefault();
                editor.view.dom.dispatchEvent(
                  new CustomEvent("markspace-open-slash-palette", {
                    bubbles: true,
                  }),
                );
                return true;
              }

              if (code === "KeyV" && !event.shiftKey) {
                if (latin) return false;
                event.preventDefault();
                markPasteGestureHandled();
                void (async () => {
                  const notePath = opts.getNotePath();
                  if (await pasteImagesIntoTiptap(editor, notePath)) return;
                  const text = await readTextFromSystemClipboard();
                  if (text) {
                    editor.chain().focus().insertContent(text).run();
                    return;
                  }
                  if (await pasteImagesIntoTiptap(editor, notePath, 2)) return;
                  warnClipboardImageMissing("Ctrl+V");
                })();
                return true;
              }

              if (latin) return false;

              if (code === "KeyB" && !event.shiftKey) {
                editor.commands.toggleBold();
                return true;
              }
              if (code === "KeyI" && !event.shiftKey) {
                editor.commands.toggleItalic();
                return true;
              }
              if (code === "KeyU" && !event.shiftKey) {
                editor.commands.toggleUnderline();
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

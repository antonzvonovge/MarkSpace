import { markdownToEditorHtml } from "../editor/tiptap/markdownBridge";

/** HTML TipTap understands on paste — same markdown→HTML path as loading a note. */
export function chatMarkdownToPasteHtml(markdown: string): string {
  return markdownToEditorHtml(markdown);
}

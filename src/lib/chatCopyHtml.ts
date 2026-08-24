import { markdownToHTML } from "@blocknote/core";
import { isolateNestedLists } from "./nestedListMarkdown";

/** HTML BlockNote understands on paste — same markdown→HTML path as loading a note. */
export function chatMarkdownToPasteHtml(markdown: string): string {
  return isolateNestedLists(markdownToHTML(markdown));
}

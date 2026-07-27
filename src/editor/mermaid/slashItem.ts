import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import { DEFAULT_MERMAID_CODE } from "./MermaidBlock";
import type { NoteEditorSchema } from "../schema";

export function insertMermaidItem(
  editor: BlockNoteEditor<NoteEditorSchema["blockSchema"]>,
): DefaultReactSuggestionItem {
  return {
    title: "Mermaid",
    subtext: "Insert a Mermaid diagram",
    aliases: ["mermaid", "diagram", "flowchart", "sequence", "chart"],
    group: "Diagrams",
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "mermaid",
        props: { code: DEFAULT_MERMAID_CODE },
      });
    },
  };
}

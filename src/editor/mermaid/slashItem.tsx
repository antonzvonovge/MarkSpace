import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiFlowChart } from "react-icons/ri";
import { DEFAULT_MERMAID_CODE } from "./MermaidBlock";
import type { NoteEditor } from "../schema";

export function insertMermaidItem(
  editor: NoteEditor,
): DefaultReactSuggestionItem {
  return {
    title: "Mermaid",
    subtext: "Insert a Mermaid diagram",
    aliases: ["mermaid", "diagram", "flowchart", "sequence", "chart"],
    group: "Diagrams",
    icon: <RiFlowChart size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "mermaid",
        props: { code: DEFAULT_MERMAID_CODE },
      });
    },
  };
}

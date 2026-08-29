import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiMindMap } from "react-icons/ri";
import type { NoteEditor } from "../schema";
import { DEFAULT_MARKMAP_CODE } from "./MarkmapBlock";

export function insertMarkmapItem(
  editor: NoteEditor,
): DefaultReactSuggestionItem {
  return {
    title: "Markmap",
    subtext: "Insert a Markmap mind map",
    aliases: ["markmap", "mindmap", "mind map", "diagram", "outline"],
    group: "Diagrams",
    icon: <RiMindMap size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "markmap",
        props: { code: DEFAULT_MARKMAP_CODE },
      });
    },
  };
}

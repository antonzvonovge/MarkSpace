import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiStackshareLine } from "react-icons/ri";
import type { NoteEditor } from "../schema";
import { DEFAULT_D2_CODE } from "./D2Block";

export function insertD2Item(editor: NoteEditor): DefaultReactSuggestionItem {
  return {
    title: "D2",
    subtext: "Insert a D2 diagram",
    aliases: ["d2", "diagram", "flowchart", "architecture", "cascade"],
    group: "Diagrams",
    icon: <RiStackshareLine size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "d2",
        props: { code: DEFAULT_D2_CODE },
      });
    },
  };
}

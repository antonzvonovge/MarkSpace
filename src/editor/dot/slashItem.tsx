import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiNodeTree } from "react-icons/ri";
import type { NoteEditor } from "../schema";
import { DEFAULT_DOT_CODE } from "./DotBlock";

export function insertDotItem(editor: NoteEditor): DefaultReactSuggestionItem {
  return {
    title: "DOT / Graphviz",
    subtext: "Insert a Graphviz DOT diagram",
    aliases: ["dot", "graphviz", "diagram", "flowchart", "cascade"],
    group: "Diagrams",
    icon: <RiNodeTree size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "dot",
        props: { code: DEFAULT_DOT_CODE },
      });
    },
  };
}

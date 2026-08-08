import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { NoteEditor } from "../schema";
import { DEFAULT_DOT_CODE } from "./DotBlock";

export function insertDotItem(editor: NoteEditor): DefaultReactSuggestionItem {
  return {
    title: "DOT / Graphviz",
    subtext: "Insert a Graphviz DOT diagram",
    aliases: ["dot", "graphviz", "diagram", "flowchart", "cascade"],
    group: "Diagrams",
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "dot",
        props: { code: DEFAULT_DOT_CODE },
      });
    },
  };
}

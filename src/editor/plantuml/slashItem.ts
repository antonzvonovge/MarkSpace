import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { DEFAULT_PLANTUML_CODE } from "./PlantUMLBlock";
import type { NoteEditor } from "../schema";

export function insertPlantUmlItem(
  editor: NoteEditor,
): DefaultReactSuggestionItem {
  return {
    title: "PlantUML",
    subtext: "Insert a PlantUML diagram",
    aliases: ["plantuml", "puml", "uml", "sequence", "diagram"],
    group: "Diagrams",
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "plantuml",
        props: { code: DEFAULT_PLANTUML_CODE },
      });
    },
  };
}

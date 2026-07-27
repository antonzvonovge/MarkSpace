import type { BlockNoteEditor } from "@blocknote/core";
import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { DEFAULT_PLANTUML_CODE } from "./PlantUMLBlock";
import type { NoteEditorSchema } from "../schema";

export function insertPlantUmlItem(
  editor: BlockNoteEditor<NoteEditorSchema["blockSchema"]>,
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

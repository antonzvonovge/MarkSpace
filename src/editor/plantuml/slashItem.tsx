import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiOrganizationChart } from "react-icons/ri";
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
    icon: <RiOrganizationChart size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "plantuml",
        props: { code: DEFAULT_PLANTUML_CODE },
      });
    },
  };
}

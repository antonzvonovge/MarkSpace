import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createMermaidBlock } from "./mermaid/MermaidBlock";
import { createPlantUmlBlock } from "./plantuml/PlantUMLBlock";

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: createMermaidBlock(),
    plantuml: createPlantUmlBlock(),
  },
});

export type NoteEditorSchema = typeof noteEditorSchema;

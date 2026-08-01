import {
  BlockNoteSchema,
  defaultBlockSpecs,
} from "@blocknote/core";
import { createDrawioBlock } from "./drawio/DrawioEmbedBlock";
import { createMermaidBlock } from "./mermaid/MermaidBlock";
import { createPlantUmlBlock } from "./plantuml/PlantUMLBlock";

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: createMermaidBlock(),
    plantuml: createPlantUmlBlock(),
    drawio: createDrawioBlock(),
  },
});

export type NoteEditorSchema = typeof noteEditorSchema;

/** Fully typed Live editor. */
export type NoteEditor = NoteEditorSchema["BlockNoteEditor"];

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { createDrawioBlock } from "./drawio/DrawioEmbedBlock";
import { latexInlineContentSpecs } from "./math/LatexInline";
import { createMathEquationBlock } from "./math/MathEquationBlock";
import { createMermaidBlock } from "./mermaid/MermaidBlock";
import { createPlantUmlBlock } from "./plantuml/PlantUMLBlock";

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    mermaid: createMermaidBlock(),
    plantuml: createPlantUmlBlock(),
    drawio: createDrawioBlock(),
    equation: createMathEquationBlock(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    ...latexInlineContentSpecs,
  },
});

export type NoteEditorSchema = typeof noteEditorSchema;

/** Fully typed Live editor. */
export type NoteEditor = NoteEditorSchema["BlockNoteEditor"];

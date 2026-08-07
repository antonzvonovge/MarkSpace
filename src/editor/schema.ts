import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { markspaceCodeBlockOptions } from "../lib/codeHighlight";
import { createDrawioBlock } from "./drawio/DrawioEmbedBlock";
import { latexInlineContentSpecs } from "./math/LatexInline";
import { createMathEquationBlock } from "./math/MathEquationBlock";
import { createMermaidBlock } from "./mermaid/MermaidBlock";
import { createPlantUmlBlock } from "./plantuml/PlantUMLBlock";

const { codeBlock: _unusedDefaultCodeBlock, ...restDefaultBlocks } =
  defaultBlockSpecs;
void _unusedDefaultCodeBlock;

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...restDefaultBlocks,
    // Syntax highlighting via Shiki (light theme); mermaid/plantuml/drawio/math
    // keep their own blocks via runsBefore: ["codeBlock"].
    codeBlock: createCodeBlockSpec(markspaceCodeBlockOptions),
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

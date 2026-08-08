import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { markspaceCodeBlockOptions } from "../lib/codeHighlight";
import { createD2Block } from "./d2/D2Block";
import { createDotBlock } from "./dot/DotBlock";
import { createDrawioBlock } from "./drawio/DrawioEmbedBlock";
import { createMarkmapBlock } from "./markmap/MarkmapBlock";
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
    // Syntax highlighting via Shiki (light theme); diagram/math blocks
    // keep their own specs via runsBefore: ["codeBlock"].
    codeBlock: createCodeBlockSpec(markspaceCodeBlockOptions),
    mermaid: createMermaidBlock(),
    plantuml: createPlantUmlBlock(),
    d2: createD2Block(),
    dot: createDotBlock(),
    markmap: createMarkmapBlock(),
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

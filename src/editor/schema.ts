import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from "@blocknote/core";
import { markspaceCodeBlockOptions } from "../lib/codeHighlight";
import { createAudioBlock } from "./audio/AudioEmbedBlock";
import { markspaceImageBlock } from "./image/ImageBlock";
import { createD2Block } from "./d2/D2Block";
import { createDotBlock } from "./dot/DotBlock";
import { createDrawioBlock } from "./drawio/DrawioEmbedBlock";
import { createMarkmapBlock } from "./markmap/MarkmapBlock";
import { latexInlineContentSpecs } from "./math/LatexInline";
import { createMathEquationBlock } from "./math/MathEquationBlock";
import { createMermaidBlock } from "./mermaid/MermaidBlock";
import { createPlantUmlBlock } from "./plantuml/PlantUMLBlock";

const {
  codeBlock: _unusedDefaultCodeBlock,
  image: _unusedDefaultImage,
  ...restDefaultBlocks
} = defaultBlockSpecs;
void _unusedDefaultCodeBlock;
void _unusedDefaultImage;

export const noteEditorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...restDefaultBlocks,
    // Syntax highlighting via Shiki (light theme); diagram/math blocks
    // keep their own specs via runsBefore: ["codeBlock"].
    codeBlock: createCodeBlockSpec(markspaceCodeBlockOptions),
    image: markspaceImageBlock(),
    mermaid: createMermaidBlock(),
    plantuml: createPlantUmlBlock(),
    d2: createD2Block(),
    dot: createDotBlock(),
    markmap: createMarkmapBlock(),
    drawio: createDrawioBlock(),
    audio: createAudioBlock(),
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

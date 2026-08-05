import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import type { NoteEditor } from "../schema";
import { DEFAULT_EQUATION_LATEX } from "./MathEquationBlock";

export function insertMathEquationItem(
  editor: NoteEditor,
): DefaultReactSuggestionItem {
  return {
    title: "Block equation",
    subtext: "Display TeX formula",
    aliases: [
      "equation",
      "math",
      "latex",
      "formula",
      "eq",
      "block equation",
      "block math",
    ],
    group: "Math",
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, {
        type: "equation",
        props: { latex: DEFAULT_EQUATION_LATEX },
      });
    },
  };
}

export function insertInlineMathItem(
  editor: NoteEditor,
): DefaultReactSuggestionItem {
  return {
    title: "Inline equation",
    subtext: "Insert TeX within text",
    aliases: [
      "inline equation",
      "inline math",
      "inline latex",
      "math",
      "equation",
    ],
    group: "Math",
    onItemClick: () => {
      editor.insertInlineContent([
        {
          type: "latex",
          props: { latex: "", displayMode: false },
        },
      ]);
    },
  };
}

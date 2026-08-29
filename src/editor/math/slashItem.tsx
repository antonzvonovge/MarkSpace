import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { RiFormula, RiFunctions } from "react-icons/ri";
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
    icon: <RiFunctions size={18} />,
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
    icon: <RiFormula size={18} />,
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

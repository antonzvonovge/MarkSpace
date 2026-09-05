import type { AnyExtension } from "@tiptap/core";
import { Extension, mergeAttributes } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import {
  TableCell,
  TableHeader,
  TableKit,
} from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { noteAtomExtensions } from "./atomNodes";
import { NoteCodeBlock } from "./codeBlock";
import { NoteImage } from "./noteImage";

export type CreateNoteTiptapExtensionsOpts = {
  /** Absolute or vault-relative path of the open note (for embeds / wiki resolution). */
  path: string;
  extraExtensions?: AnyExtension[];
};

/** Stores the active note path for TipTap consumers (audio/wiki resolution). */
export const NotePath = Extension.create<{ path: string }>({
  name: "notePath",
  addOptions() {
    return { path: "" };
  },
});

function cellColorAttributes() {
  return {
    backgroundColor: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute("data-background-color") ||
        element.style.backgroundColor ||
        null,
      renderHTML: (attributes: { backgroundColor?: string | null }) => {
        const color = attributes.backgroundColor;
        if (!color || color === "default") return {};
        return {
          "data-background-color": color,
          style: `background-color: ${color}`,
        };
      },
    },
    textColor: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute("data-text-color") || null,
      renderHTML: (attributes: { textColor?: string | null }) => {
        const color = attributes.textColor;
        if (!color || color === "default") return {};
        // data-attr only — avoid clobbering backgroundColor's `style`
        return { "data-text-color": color };
      },
    },
  };
}

/** Table cell with MarkSpace colored-table attrs (`data-background-color`). */
export const ColoredTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellColorAttributes(),
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

/** Table header with the same color attrs as cells. */
export const ColoredTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellColorAttributes(),
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

/**
 * TipTap extension set for MarkSpace notes (StarterKit + atoms + tables + tasks).
 */
export function createNoteTiptapExtensions(
  opts: CreateNoteTiptapExtensionsOpts,
): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      underline: false,
    }),
    NotePath.configure({ path: opts.path }),
    Underline,
    Link.configure({
      openOnClick: false,
      protocols: ["http", "https", "mailto", "wiki"],
      HTMLAttributes: {
        class: "bn-link",
        rel: "noopener noreferrer nofollow",
      },
    }),
    NoteImage,
    TableKit.configure({
      tableCell: false,
      tableHeader: false,
    }),
    ColoredTableCell,
    ColoredTableHeader,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    ...noteAtomExtensions,
    NoteCodeBlock,
    ...(opts.extraExtensions ?? []),
  ];
}

export {
  Audio,
  D2,
  Dot,
  Drawio,
  Equation,
  LatexInline,
  Markmap,
  Mermaid,
  PlantUml,
  noteAtomExtensions,
} from "./atomNodes";
export { NoteCodeBlock } from "./codeBlock";

/**
 * Slash / Ctrl+Space insert catalog for TipTap Live.
 * Kept flat and sync so filtering stays cheap on every keystroke.
 */

import type { Editor } from "@tiptap/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import {
  RiArtboard2Line,
  RiCheckboxLine,
  RiCodeBlock,
  RiCodeSSlashLine,
  RiFlowChart,
  RiFolderOpenLine,
  RiFormula,
  RiFunctions,
  RiH1,
  RiH2,
  RiH3,
  RiImageLine,
  RiLink,
  RiListOrdered,
  RiListUnordered,
  RiMindMap,
  RiOrganizationChart,
  RiParagraph,
  RiQuoteText,
  RiSeparator,
  RiTable2,
} from "react-icons/ri";
import {
  absolutePath,
  createDrawio,
  getVaultPath,
  importDrawio,
  joinPath,
  parentPath,
  readFileBytes,
  writeAsset,
} from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import { DEFAULT_D2_CODE } from "../d2/D2Block";
import { DEFAULT_DOT_CODE } from "../dot/DotBlock";
import { DEFAULT_DRAWIO_PREVIEW_WIDTH } from "../drawio/constants";
import { DEFAULT_MARKMAP_CODE } from "../markmap/MarkmapBlock";
import { DEFAULT_EQUATION_LATEX } from "../math/MathEquationBlock";
import { DEFAULT_MERMAID_CODE } from "../mermaid/MermaidBlock";
import { DEFAULT_PLANTUML_CODE } from "../plantuml/PlantUMLBlock";

export type SlashMenuItem = {
  id: string;
  title: string;
  subtext?: string;
  aliases?: string[];
  group: string;
  icon: ReactNode;
  run: (editor: Editor, notePath: string) => void | Promise<void>;
};

export type WikiLinkPickerOpenOpts = {
  initialLabel: string;
  from: number;
  to: number;
};

function uniqueDiagramName(base: string): string {
  return `${base}-${Date.now().toString(36)}`;
}

async function noteFolderAbsolute(notePath: string): Promise<string> {
  const folder = parentPath(notePath);
  if (folder) return absolutePath(folder);
  const vault = await getVaultPath();
  if (!vault) throw new Error("No vault open");
  return vault;
}

function basenameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "image.png";
}

function base64ToUint8(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Build the insert catalog (stable icons; call once per menu open or memoize). */
export function buildSlashMenuItems(opts: {
  openWikiLinkPicker: (opts: WikiLinkPickerOpenOpts) => void;
}): SlashMenuItem[] {
  const { openWikiLinkPicker } = opts;

  return [
    {
      id: "paragraph",
      title: "Paragraph",
      aliases: ["text", "p"],
      group: "Basic blocks",
      icon: <RiParagraph size={18} />,
      run: (editor) => {
        editor.chain().focus().setParagraph().run();
      },
    },
    {
      id: "heading1",
      title: "Heading 1",
      aliases: ["h1", "title"],
      group: "Basic blocks",
      icon: <RiH1 size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleHeading({ level: 1 }).run();
      },
    },
    {
      id: "heading2",
      title: "Heading 2",
      aliases: ["h2"],
      group: "Basic blocks",
      icon: <RiH2 size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
      },
    },
    {
      id: "heading3",
      title: "Heading 3",
      aliases: ["h3"],
      group: "Basic blocks",
      icon: <RiH3 size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
      },
    },
    {
      id: "quote",
      title: "Quote",
      aliases: ["blockquote", "citation"],
      group: "Basic blocks",
      icon: <RiQuoteText size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleBlockquote().run();
      },
    },
    {
      id: "bulletList",
      title: "Bullet list",
      aliases: ["ul", "unordered"],
      group: "Basic blocks",
      icon: <RiListUnordered size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleBulletList().run();
      },
    },
    {
      id: "orderedList",
      title: "Numbered list",
      aliases: ["ol", "ordered"],
      group: "Basic blocks",
      icon: <RiListOrdered size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleOrderedList().run();
      },
    },
    {
      id: "taskList",
      title: "Check list",
      aliases: ["todo", "task", "checkbox"],
      group: "Basic blocks",
      icon: <RiCheckboxLine size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleTaskList().run();
      },
    },
    {
      id: "codeBlock",
      title: "Code block",
      aliases: ["code", "pre"],
      group: "Basic blocks",
      icon: <RiCodeBlock size={18} />,
      run: (editor) => {
        editor.chain().focus().toggleCodeBlock().run();
      },
    },
    {
      id: "divider",
      title: "Divider",
      aliases: ["hr", "horizontal rule", "separator"],
      group: "Basic blocks",
      icon: <RiSeparator size={18} />,
      run: (editor) => {
        editor.chain().focus().setHorizontalRule().run();
      },
    },
    {
      id: "table",
      title: "Table",
      aliases: ["grid"],
      group: "Basic blocks",
      icon: <RiTable2 size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run();
      },
    },
    {
      id: "image",
      title: "Image",
      aliases: ["img", "picture", "photo", "media"],
      group: "Media",
      icon: <RiImageLine size={18} />,
      run: async (editor, notePath) => {
        const selected = await open({
          multiple: false,
          title: "Select image",
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
            },
          ],
        });
        if (typeof selected !== "string" || !selected) return;
        const file = await readFileBytes(selected);
        const name = basenameFromPath(file.path || selected);
        const url = await writeAsset(notePath, name, base64ToUint8(file.dataBase64));
        editor
          .chain()
          .focus()
          .insertContent({ type: "image", attrs: { src: url, alt: "" } })
          .run();
      },
    },
    {
      id: "wikiLink",
      title: "Insert note link",
      subtext: "Link to a vault note, folder, or document",
      aliases: ["link", "wiki", "note", "wikilink", "ссылка"],
      group: "Links",
      icon: <RiLink size={18} />,
      run: (editor) => {
        const { from, to } = editor.state.selection;
        const initialLabel =
          from === to
            ? ""
            : editor.state.doc.textBetween(from, to, " ").trim();
        window.setTimeout(() => {
          openWikiLinkPicker({ initialLabel, from, to });
        }, 0);
      },
    },
    {
      id: "mermaid",
      title: "Mermaid",
      subtext: "Insert a Mermaid diagram",
      aliases: ["mermaid", "diagram", "flowchart", "sequence", "chart"],
      group: "Diagrams",
      icon: <RiFlowChart size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "mermaid",
            attrs: { code: DEFAULT_MERMAID_CODE },
          })
          .run();
      },
    },
    {
      id: "plantuml",
      title: "PlantUML",
      subtext: "Insert a PlantUML diagram",
      aliases: ["plantuml", "puml", "uml", "sequence", "diagram"],
      group: "Diagrams",
      icon: <RiOrganizationChart size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "plantuml",
            attrs: { code: DEFAULT_PLANTUML_CODE },
          })
          .run();
      },
    },
    {
      id: "d2",
      title: "D2",
      subtext: "Insert a D2 diagram",
      aliases: ["d2", "diagram"],
      group: "Diagrams",
      icon: <RiCodeSSlashLine size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({ type: "d2", attrs: { code: DEFAULT_D2_CODE } })
          .run();
      },
    },
    {
      id: "dot",
      title: "DOT / Graphviz",
      subtext: "Insert a Graphviz DOT diagram",
      aliases: ["dot", "graphviz", "diagram"],
      group: "Diagrams",
      icon: <RiOrganizationChart size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({ type: "dot", attrs: { code: DEFAULT_DOT_CODE } })
          .run();
      },
    },
    {
      id: "markmap",
      title: "Markmap",
      subtext: "Insert a Markmap mind map",
      aliases: ["markmap", "mindmap", "mind map"],
      group: "Diagrams",
      icon: <RiMindMap size={18} />,
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "markmap",
            attrs: { code: DEFAULT_MARKMAP_CODE },
          })
          .run();
      },
    },
    {
      id: "drawio-new",
      title: "Draw.io — new",
      subtext: "Create a new diagram file and embed it",
      aliases: ["drawio", "draw.io", "diagram", "new drawio", "создать"],
      group: "Diagrams",
      icon: <RiArtboard2Line size={18} />,
      run: async (editor, notePath) => {
        const folder = parentPath(notePath);
        const name = uniqueDiagramName("Diagram");
        const created = await createDrawio(joinPath(folder, name));
        await useVaultStore.getState().refreshTree();
        editor
          .chain()
          .focus()
          .insertContent({
            type: "drawio",
            attrs: {
              src: created,
              previewWidth: DEFAULT_DRAWIO_PREVIEW_WIDTH,
            },
          })
          .run();
      },
    },
    {
      id: "drawio-choose",
      title: "Draw.io — choose",
      subtext: "Pick an existing .drawio (copies into vault if outside)",
      aliases: [
        "drawio",
        "draw.io",
        "diagram",
        "embed drawio",
        "choose drawio",
        "выбрать",
      ],
      group: "Diagrams",
      icon: <RiFolderOpenLine size={18} />,
      run: async (editor, notePath) => {
        const defaultPath = await noteFolderAbsolute(notePath);
        const selected = await open({
          multiple: false,
          defaultPath,
          title: "Select Draw.io diagram",
          filters: [{ name: "Draw.io", extensions: ["drawio"] }],
        });
        if (typeof selected !== "string" || !selected) return;
        const embedded = await importDrawio(notePath, selected);
        await useVaultStore.getState().refreshTree();
        editor
          .chain()
          .focus()
          .insertContent({
            type: "drawio",
            attrs: {
              src: embedded,
              previewWidth: DEFAULT_DRAWIO_PREVIEW_WIDTH,
            },
          })
          .run();
      },
    },
    {
      id: "equation",
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
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "equation",
            attrs: { latex: DEFAULT_EQUATION_LATEX },
          })
          .run();
      },
    },
    {
      id: "inline-equation",
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
      run: (editor) => {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "latex",
            attrs: { latex: "", displayMode: false },
          })
          .run();
      },
    },
  ];
}

/** Filter slash items by title / aliases (short generic aliases ignored for tiny queries). */
export function filterSlashMenuItems(
  items: SlashMenuItem[],
  query: string,
): SlashMenuItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    const aliases = item.aliases ?? [];
    return aliases.some((alias) => {
      const a = alias.toLowerCase();
      if (q.length <= 2 && (a === "media" || a === "url" || a === "upload")) {
        return false;
      }
      return a.includes(q);
    });
  });
}

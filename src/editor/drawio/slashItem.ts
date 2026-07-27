import type { BlockNoteEditor } from "@blocknote/core";
import { getBlockInfoAtNearest, getNodeId } from "@blocknote/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import {
  absolutePath,
  createDrawio,
  getVaultPath,
  importDrawio,
  joinPath,
  parentPath,
} from "../../lib/vaultApi";
import { useVaultStore } from "../../store/vaultStore";
import type { NoteEditorSchema } from "../schema";
import { DEFAULT_DRAWIO_PREVIEW_WIDTH } from "./constants";

type Editor = BlockNoteEditor<NoteEditorSchema["blockSchema"]>;

export type DrawioDropPoint = { x: number; y: number };

function uniqueDiagramName(base: string): string {
  const stamp = Date.now().toString(36);
  return `${base}-${stamp}`;
}

function resolveDropTarget(
  editor: Editor,
  at: DrawioDropPoint,
): { blockId: string; placement: "before" | "after" } | null {
  const view = editor.prosemirrorView;
  const pos = view.posAtCoords({ left: at.x, top: at.y });
  if (!pos) {
    const last = editor.document[editor.document.length - 1];
    return last ? { blockId: last.id, placement: "after" } : null;
  }

  try {
    const blockId = editor.transact((tr) => {
      const info = getBlockInfoAtNearest(tr, pos.pos);
      return getNodeId(info.bnBlock.node, tr.doc);
    });
    const el = editor.domElement?.querySelector(`[data-id="${CSS.escape(blockId)}"]`);
    const rect = el?.getBoundingClientRect();
    const placement: "before" | "after" =
      rect && (rect.top + rect.bottom) / 2 > at.y ? "before" : "after";
    return { blockId, placement };
  } catch {
    return null;
  }
}

export function insertDrawioEmbed(
  editor: Editor,
  src: string,
  at?: DrawioDropPoint | null,
) {
  const block = {
    type: "drawio" as const,
    props: {
      src,
      previewWidth: DEFAULT_DRAWIO_PREVIEW_WIDTH,
    },
  };

  try {
    let reference = editor.getTextCursorPosition().block;
    let placement: "before" | "after" = "after";

    if (at) {
      const target = resolveDropTarget(editor, at);
      if (target) {
        const found = editor.getBlock(target.blockId);
        if (found) {
          reference = found;
          placement = target.placement;
        }
      }
    }

    const emptyParagraph =
      reference.type === "paragraph" &&
      Array.isArray(reference.content) &&
      reference.content.length === 0;

    if (emptyParagraph) {
      editor.updateBlock(reference, block);
      editor.setTextCursorPosition(reference);
      return;
    }

    const inserted = editor.insertBlocks([block], reference, placement)[0];
    if (inserted) editor.setTextCursorPosition(inserted);
  } catch {
    const last = editor.document[editor.document.length - 1];
    if (last) {
      editor.insertBlocks([block], last, "after");
    } else {
      editor.replaceBlocks(editor.document, [block]);
    }
  }
}

async function noteFolderAbsolute(notePath: string): Promise<string> {
  const folder = parentPath(notePath);
  if (folder) return absolutePath(folder);
  const vault = await getVaultPath();
  if (!vault) throw new Error("No vault open");
  return vault;
}

export function insertNewDrawioItem(
  editor: Editor,
  notePath: string,
): DefaultReactSuggestionItem {
  return {
    title: "Draw.io — new",
    subtext: "Create a new diagram file and embed it",
    aliases: ["drawio", "draw.io", "diagram", "new drawio", "создать"],
    group: "Diagrams",
    onItemClick: () => {
      void (async () => {
        const folder = parentPath(notePath);
        const name = uniqueDiagramName("Diagram");
        const created = await createDrawio(joinPath(folder, name));
        await useVaultStore.getState().refreshTree();
        insertDrawioEmbed(editor, created);
      })();
    },
  };
}

export function insertExistingDrawioItem(
  editor: Editor,
  notePath: string,
): DefaultReactSuggestionItem {
  return {
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
    onItemClick: () => {
      void (async () => {
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
        insertDrawioEmbed(editor, embedded);
      })();
    },
  };
}

/** @deprecated use insertNewDrawioItem / insertExistingDrawioItem */
export function insertDrawioItem(editor: Editor, notePath: string) {
  return insertNewDrawioItem(editor, notePath);
}

import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin } from "prosemirror-state";

/**
 * After an in-document block drop, ProseMirror selects the outer
 * `blockContainer`. For atom React blocks (mermaid / plantuml / drawio /
 * images) the blue outline only appears when the *content* node is selected
 * (`ProseMirror-selectednode` on the TipTap node-view renderer). Remap the
 * post-drop selection onto that atom so the frame shows immediately.
 */
export function createSelectAtomBlockAfterDropExtension() {
  return Extension.create({
    name: "selectAtomBlockAfterDrop",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction(transactions, _oldState, newState) {
            const dropped = transactions.some(
              (tr) => tr.getMeta("uiEvent") === "drop",
            );
            if (!dropped) return null;

            const sel = newState.selection;
            if (!(sel instanceof NodeSelection)) return null;
            if (sel.node.type.name !== "blockContainer") return null;

            const content = sel.node.firstChild;
            if (!content?.isAtom || !NodeSelection.isSelectable(content)) {
              return null;
            }

            const contentPos = sel.from + 1;
            const next = NodeSelection.create(newState.doc, contentPos);
            if (sel.eq(next)) return null;
            return newState.tr.setSelection(next);
          },
        }),
      ];
    },
  });
}

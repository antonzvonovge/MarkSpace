import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isValidTagName, TAG_NAME_PATTERN } from "../../lib/hashtagMarkdown";

const pluginKey = new PluginKey("hashtagDecorations");

const FIND_RE = new RegExp(
  `(^|[^\\p{L}\\p{N}_/-])#(${TAG_NAME_PATTERN})`,
  "gu",
);

function decorationsForDoc(doc: import("@tiptap/pm/model").Node): DecorationSet {
  const out: ReturnType<typeof Decoration.inline>[] = [];

  doc.descendants((node, pos) => {
    if (node.type.spec.code || node.type.name === "codeBlock") {
      return false;
    }
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === "code")) return;

    FIND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FIND_RE.exec(node.text)) !== null) {
      const name = m[2]!;
      if (!isValidTagName(name)) continue;
      const hashOffset = m.index + m[1]!.length;
      const from = pos + hashOffset;
      const to = from + 1 + name.length;
      out.push(
        Decoration.inline(from, to, {
          class: "note-inline-tag",
        }),
      );
    }
  });

  return DecorationSet.create(doc, out);
}

/**
 * Styles `#tags` as chips while leaving them as ordinary editable text
 * (Obsidian-like). No atom nodes — cursor can move through and edit freely.
 */
export function createHashtagDecorationExtension() {
  return Extension.create({
    name: "hashtagDecorations",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          state: {
            init: (_, state) => decorationsForDoc(state.doc),
            apply: (tr, old) =>
              tr.docChanged ? decorationsForDoc(tr.doc) : old,
          },
          props: {
            decorations(state) {
              return pluginKey.getState(state);
            },
          },
        }),
      ];
    },
  });
}

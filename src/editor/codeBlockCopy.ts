import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { writeClipboardText } from "../lib/clipboardText";

const pluginKey = new PluginKey("codeBlockCopy");

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.5 2A1.5 1.5 0 004 3.5V4h-.5A1.5 1.5 0 002 5.5v7A1.5 1.5 0 003.5 14h6a1.5 1.5 0 001.5-1.5V12h.5A1.5 1.5 0 0013 10.5v-7A1.5 1.5 0 0011.5 2h-6zM5 3.5a.5.5 0 01.5-.5h6a.5.5 0 01.5.5v7a.5.5 0 01-.5.5H11V5.5A1.5 1.5 0 009.5 4H5v-.5zM3.5 5H9.5a.5.5 0 01.5.5v7a.5.5 0 01-.5.5h-6a.5.5 0 01-.5-.5v-7a.5.5 0 01.5-.5z"/></svg>`;

const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.5 11.2L3.3 8l1.06-1.06L6.5 9.08l5.14-5.14L12.7 5 6.5 11.2z"/></svg>`;

function createCopyButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "code-block-copy-btn";
  btn.setAttribute("aria-label", "Copy code");
  btn.title = "Copy code";
  btn.innerHTML = COPY_ICON;
  btn.contentEditable = "false";
  btn.tabIndex = -1;

  let resetTimer: number | undefined;

  const onPointerDown = (event: Event) => {
    // Keep the caret in the code block; don't let ProseMirror eat the click.
    event.preventDefault();
    event.stopPropagation();
  };

  const onClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    const block = btn.closest(
      '.bn-block-content[data-content-type="codeBlock"]',
    );
    const pre = block?.querySelector("pre");
    const text = pre?.textContent ?? "";
    if (!text) return;
    void writeClipboardText(text).then(() => {
      btn.classList.add("is-copied");
      btn.innerHTML = CHECK_ICON;
      btn.title = "Copied";
      btn.setAttribute("aria-label", "Copied");
      if (resetTimer !== undefined) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = COPY_ICON;
        btn.title = "Copy code";
        btn.setAttribute("aria-label", "Copy code");
      }, 1500);
    });
  };

  btn.addEventListener("pointerdown", onPointerDown);
  btn.addEventListener("mousedown", onPointerDown);
  btn.addEventListener("click", onClick);

  return btn;
}

function decorationsForDoc(doc: import("@tiptap/pm/model").Node): DecorationSet {
  const out: ReturnType<typeof Decoration.widget>[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    // Widget sits at the start of the block; absolute CSS parks it top-right.
    // Key by position so the button DOM is reused across edits (text is read live).
    out.push(
      Decoration.widget(pos + 1, () => createCopyButton(), {
        side: -1,
        ignoreSelection: true,
        key: `code-copy-${pos}`,
      }),
    );
  });

  return DecorationSet.create(doc, out);
}

/** Adds a top-right copy control to Live editor code blocks. */
export function createCodeBlockCopyExtension() {
  return Extension.create({
    name: "codeBlockCopy",
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

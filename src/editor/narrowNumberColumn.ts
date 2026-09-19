import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { isNumberColumnHeader } from "../lib/tableColumnHeaders";

const ATTR = "data-narrow-first-col";
const pluginKey = new PluginKey("narrowNumberColumn");

/** Sync `data-narrow-first-col` from the first header cell text only. */
function syncNarrowFirstColumns(root: HTMLElement): void {
  const tables = root.querySelectorAll<HTMLTableElement>(
    '[data-content-type="table"] table',
  );
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]!;
    const cell = table.querySelector("tr:first-child > :first-child");
    const label = cell?.textContent?.trim() ?? "";
    const want = label.length > 0 && isNumberColumnHeader(label);
    if (want) {
      if (!table.hasAttribute(ATTR)) table.setAttribute(ATTR, "");
    } else if (table.hasAttribute(ATTR)) {
      table.removeAttribute(ATTR);
    }
  }
}

/**
 * Marks Live-editor tables whose first header looks like a number column.
 * One rAF per doc change; only reads the first header cell per table.
 */
export function createNarrowNumberColumnExtension() {
  return Extension.create({
    name: "narrowNumberColumn",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          view(editorView) {
            let raf = 0;
            const schedule = () => {
              if (raf) return;
              raf = requestAnimationFrame(() => {
                raf = 0;
                syncNarrowFirstColumns(editorView.dom as HTMLElement);
              });
            };
            schedule();
            return {
              update(_view, prevState) {
                if (!editorView.state.doc.eq(prevState.doc)) schedule();
              },
              destroy() {
                if (raf) cancelAnimationFrame(raf);
              },
            };
          },
        }),
      ];
    },
  });
}

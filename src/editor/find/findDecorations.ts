import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  collectFindRanges,
  type TextRange,
} from "../../lib/documentFind";

const pluginKey = new PluginKey("documentFindDecorations");

export const FIND_MATCH_ATTR = "data-find-match";
export const FIND_CURRENT_ATTR = "data-find-current";

export type FindDecorationsMeta = {
  query?: string;
  matchCase?: boolean;
  activeIndex?: number;
  clear?: boolean;
};

type PluginState = {
  query: string;
  matchCase: boolean;
  activeIndex: number;
  ranges: TextRange[];
  decorations: DecorationSet;
};

function decorationsForRanges(
  doc: import("@tiptap/pm/model").Node,
  ranges: TextRange[],
  activeIndex: number,
): DecorationSet {
  const out: ReturnType<typeof Decoration.inline>[] = [];
  const size = doc.content.size;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]!;
    if (r.from >= r.to || r.to > size) continue;
    const current = i === activeIndex;
    out.push(
      Decoration.inline(r.from, r.to, {
        class: current ? "note-find-match is-current" : "note-find-match",
        [FIND_MATCH_ATTR]: "true",
        ...(current ? { [FIND_CURRENT_ATTR]: "true" } : {}),
      }),
    );
  }
  return DecorationSet.create(doc, out);
}

function emptyState(): PluginState {
  return {
    query: "",
    matchCase: false,
    activeIndex: -1,
    ranges: [],
    decorations: DecorationSet.empty,
  };
}

export function createFindDecorationExtension() {
  return Extension.create({
    name: "documentFindDecorations",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          state: {
            init: () => emptyState(),
            apply: (tr, prev, _old, state) => {
              const meta = tr.getMeta(pluginKey) as
                | FindDecorationsMeta
                | undefined;
              if (meta?.clear) {
                return emptyState();
              }

              let query = prev.query;
              let matchCase = prev.matchCase;
              let activeIndex = prev.activeIndex;
              const metaTouched = Boolean(meta);

              if (meta && "query" in meta && meta.query != null) {
                query = meta.query;
              }
              if (meta && "matchCase" in meta && meta.matchCase != null) {
                matchCase = meta.matchCase;
              }
              if (meta && "activeIndex" in meta && meta.activeIndex != null) {
                activeIndex = meta.activeIndex;
              }

              const docChanged = tr.docChanged;
              if (!docChanged && !metaTouched) return prev;

              const shouldRescan =
                docChanged ||
                meta?.query != null ||
                meta?.matchCase != null;
              const ranges = shouldRescan
                ? collectFindRanges(state.doc, query, matchCase)
                : prev.ranges;

              if (ranges.length === 0) {
                activeIndex = -1;
              } else if (activeIndex >= ranges.length) {
                activeIndex = ranges.length - 1;
              } else if (activeIndex < 0) {
                activeIndex = 0;
              }

              return {
                query,
                matchCase,
                activeIndex,
                ranges,
                decorations: decorationsForRanges(
                  state.doc,
                  ranges,
                  activeIndex,
                ),
              } satisfies PluginState;
            },
          },
          props: {
            decorations(state) {
              return (pluginKey.getState(state) as PluginState | undefined)
                ?.decorations;
            },
          },
        }),
      ];
    },
  });
}

export function setFindDecorationsMeta(
  view: {
    dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
    state: import("@tiptap/pm/state").EditorState;
  },
  meta: FindDecorationsMeta,
): void {
  view.dispatch(
    view.state.tr
      .setMeta(pluginKey, meta)
      .setMeta("addToHistory", false),
  );
}

export function getFindPluginState(
  view: { state: import("@tiptap/pm/state").EditorState },
): PluginState | undefined {
  return pluginKey.getState(view.state) as PluginState | undefined;
}

export function scrollToCurrentFindMatch(view: {
  state: import("@tiptap/pm/state").EditorState;
  dom: Element;
  coordsAtPos?: (pos: number) => { top: number; left: number };
}): boolean {
  const st = pluginKey.getState(view.state) as PluginState | undefined;
  if (!st || st.activeIndex < 0) return false;
  const range = st.ranges[st.activeIndex];
  if (!range) return false;

  const scrollMark = () => {
    const el = view.dom.querySelector(`[${FIND_CURRENT_ATTR}]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      return true;
    }
    const coordsAtPos = view.coordsAtPos;
    if (!coordsAtPos) return false;
    try {
      const coords = coordsAtPos(range.from);
      const scroller = view.dom.closest(".editor-main") ?? view.dom;
      const rect = scroller.getBoundingClientRect();
      const targetTop =
        scroller.scrollTop + (coords.top - rect.top) - rect.height * 0.35;
      scroller.scrollTo({ top: Math.max(0, targetTop) });
      return true;
    } catch {
      return false;
    }
  };

  requestAnimationFrame(() => {
    if (!scrollMark()) {
      requestAnimationFrame(() => {
        scrollMark();
      });
    }
  });
  return true;
}

export { pluginKey as findDecorationsPluginKey };

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  detectAnchorUpdates,
  findCommentRanges,
  mapCommentRanges,
  syncCommentRanges,
  type CommentAnchor,
  type CommentAnchorUpdate,
  type CommentRange,
} from "../../lib/commentAnchors";

const pluginKey = new PluginKey("commentDecorations");

type PluginState = {
  comments: CommentAnchor[];
  showResolved: boolean;
  activeId: string | null;
  ranges: CommentRange[];
  decorations: DecorationSet;
};

function decorationsForDoc(
  doc: import("@tiptap/pm/model").Node,
  ranges: CommentRange[],
  showResolved: boolean,
  activeId: string | null,
): DecorationSet {
  const visible = ranges.filter((r) => showResolved || !r.resolved);
  const out: ReturnType<typeof Decoration.inline>[] = [];
  for (const r of visible) {
    if (r.from >= r.to || r.to > doc.content.size) continue;
    const classes = ["note-comment-mark"];
    if (r.resolved) classes.push("is-resolved");
    if (activeId && r.id === activeId) classes.push("is-active");
    out.push(
      Decoration.inline(r.from, r.to, {
        class: classes.join(" "),
        "data-comment-id": r.id,
      }),
    );
    // Inline decorations skip leaf nodes, so images/diagrams need node ones.
    doc.nodesBetween(r.from, r.to, (node, pos) => {
      if (!node.isLeaf || node.isText) return true;
      if (pos < r.from || pos + node.nodeSize > r.to) return true;
      out.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: [...classes, "note-comment-node"].join(" "),
          "data-comment-id": r.id,
        }),
      );
      return false;
    });
  }
  return DecorationSet.create(doc, out);
}

export type CommentDecorationsMeta = {
  comments?: CommentAnchor[];
  showResolved?: boolean;
  activeId?: string | null;
  /** Force re-resolve all ranges from quotes (e.g. after external note load). */
  resetRanges?: boolean;
};

export type CommentDecorationsOptions = {
  /** Called when live range text drifts from stored quote (debounced by caller). */
  getOnAnchorsChanged?: () =>
    | ((updates: CommentAnchorUpdate[]) => void)
    | undefined;
};

/**
 * Highlights comment ranges; maps positions through edits so the link survives
 * typing inside the quoted span, and reports quote updates for persistence.
 */
export function createCommentDecorationExtension(
  initial: {
    comments?: CommentAnchor[];
    showResolved?: boolean;
    activeId?: string | null;
  } & CommentDecorationsOptions = {},
) {
  const getOnAnchorsChanged = initial.getOnAnchorsChanged;

  return Extension.create({
    name: "commentDecorations",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: pluginKey,
          state: {
            init: (_, state) => {
              const comments = initial.comments ?? [];
              const showResolved = initial.showResolved ?? false;
              const activeId = initial.activeId ?? null;
              const ranges = findCommentRanges(state.doc, comments);
              return {
                comments,
                showResolved,
                activeId,
                ranges,
                decorations: decorationsForDoc(
                  state.doc,
                  ranges,
                  showResolved,
                  activeId,
                ),
              } satisfies PluginState;
            },
            apply: (tr, prev, _old, state) => {
              const meta = tr.getMeta(pluginKey) as
                | CommentDecorationsMeta
                | undefined;
              let comments = prev.comments;
              let showResolved = prev.showResolved;
              let activeId = prev.activeId;
              let ranges = prev.ranges;
              const metaTouched = Boolean(meta);

              if (meta?.comments) {
                comments = meta.comments;
              }
              if (meta && "showResolved" in meta && meta.showResolved != null) {
                showResolved = meta.showResolved;
              }
              if (meta && "activeId" in meta) {
                activeId = meta.activeId ?? null;
              }

              if (meta?.resetRanges && meta.comments) {
                ranges = findCommentRanges(state.doc, comments);
              } else if (meta?.comments) {
                ranges = syncCommentRanges(state.doc, comments, ranges);
              }

              if (tr.docChanged) {
                ranges = mapCommentRanges(
                  ranges,
                  tr.mapping,
                  state.doc.content.size,
                );
                const still = new Set(ranges.map((r) => r.id));
                const missing = comments.filter((c) => !still.has(c.id));
                if (missing.length > 0) {
                  ranges = syncCommentRanges(state.doc, comments, ranges);
                }
              }

              if (tr.docChanged || metaTouched) {
                return {
                  comments,
                  showResolved,
                  activeId,
                  ranges,
                  decorations: decorationsForDoc(
                    state.doc,
                    ranges,
                    showResolved,
                    activeId,
                  ),
                };
              }
              return prev;
            },
          },
          view: () => ({
            update: (view, prevState) => {
              if (!view.state.doc.eq(prevState.doc)) {
                const st = pluginKey.getState(view.state) as
                  | PluginState
                  | undefined;
                if (!st) return;
                const updates = detectAnchorUpdates(
                  view.state.doc,
                  st.comments,
                  st.ranges,
                );
                if (updates.length > 0) {
                  getOnAnchorsChanged?.()?.(updates);
                }
              }
            },
          }),
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

export function setCommentDecorationsMeta(
  view: {
    dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
    state: import("@tiptap/pm/state").EditorState;
  },
  meta: CommentDecorationsMeta,
): void {
  const tr = view.state.tr.setMeta(pluginKey, meta);
  view.dispatch(tr);
}

/** Live resolved ranges from the decorations plugin (empty if plugin absent). */
export function getCommentRanges(
  view: { state: import("@tiptap/pm/state").EditorState },
): CommentRange[] {
  const st = pluginKey.getState(view.state) as PluginState | undefined;
  return st?.ranges ? [...st.ranges] : [];
}

export function scrollToCommentRange(
  view: {
    state: import("@tiptap/pm/state").EditorState;
    dispatch: (tr: import("@tiptap/pm/state").Transaction) => void;
    dom: Element;
  },
  comments: CommentAnchor[],
  commentId: string,
): boolean {
  const st = pluginKey.getState(view.state) as PluginState | undefined;
  const ranges = st?.ranges?.length
    ? st.ranges
    : findCommentRanges(view.state.doc, comments);
  const range = ranges.find((r) => r.id === commentId);
  if (!range) return false;
  const { from, to } = range;
  const tr = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, from, to))
    .setMeta(pluginKey, {
      activeId: commentId,
    } satisfies CommentDecorationsMeta);
  view.dispatch(tr);

  const scrollMark = () => {
    const el = view.dom.querySelector(
      `[data-comment-id="${CSS.escape(commentId)}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    // Fallback: scroll selection coords into the nearest scroll parent.
    const coordsAtPos = (
      view as unknown as {
        coordsAtPos?: (pos: number) => { top: number; left: number };
      }
    ).coordsAtPos;
    if (!coordsAtPos) return false;
    try {
      const coords = coordsAtPos(from);
      const scroller = view.dom.closest(".editor-main") ?? view.dom;
      const rect = scroller.getBoundingClientRect();
      const targetTop =
        scroller.scrollTop + (coords.top - rect.top) - rect.height * 0.35;
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
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

export { pluginKey as commentDecorationsPluginKey };

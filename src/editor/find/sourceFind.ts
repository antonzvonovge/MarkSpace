import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { TextRange } from "../../lib/documentFind";

export type SourceFindPayload = {
  ranges: TextRange[];
  activeIndex: number;
};

export const setSourceFindEffect = StateEffect.define<SourceFindPayload>();

function marksForPayload(payload: SourceFindPayload): DecorationSet {
  const widgets = payload.ranges
    .filter((r) => r.from < r.to)
    .map((r, i) =>
      Decoration.mark({
        class:
          i === payload.activeIndex
            ? "note-find-match is-current"
            : "note-find-match",
        attributes:
          i === payload.activeIndex ? { "data-find-current": "true" } : {},
      }).range(r.from, r.to),
    );
  return Decoration.set(widgets, true);
}

export const sourceFindField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setSourceFindEffect)) {
        deco = marksForPayload(effect.value);
      }
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function applySourceFind(
  view: EditorView,
  payload: SourceFindPayload,
  scroll: boolean,
): void {
  const current = payload.ranges[payload.activeIndex];
  const findEffect = setSourceFindEffect.of(payload);
  if (scroll && current) {
    view.dispatch({
      effects: [
        findEffect,
        EditorView.scrollIntoView(current.from, { y: "center" }),
      ],
    });
    return;
  }
  view.dispatch({ effects: findEffect });
}

export function clearSourceFind(view: EditorView): void {
  view.dispatch({
    effects: setSourceFindEffect.of({ ranges: [], activeIndex: -1 }),
  });
}

import { describe, expect, it } from "vitest";
import { computeCommentCardLayout } from "./commentLayout";

function fakeShell(opts: {
  editorScrollTop?: number;
  editorScrollHeight?: number;
  marks: { id: string; top: number; height?: number }[];
  cards: { id: string; height: number }[];
}): HTMLElement {
  const editorTop = 100;
  const marks = new Map(
    opts.marks.map((m) => [
      m.id,
      {
        getBoundingClientRect: () => ({
          top: editorTop + m.top - (opts.editorScrollTop ?? 0),
          bottom: editorTop + m.top - (opts.editorScrollTop ?? 0) + (m.height ?? 16),
          left: 0,
          right: 40,
          width: 40,
          height: m.height ?? 16,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      },
    ]),
  );
  const cards = new Map(
    opts.cards.map((c) => [
      c.id,
      { offsetHeight: c.height } as HTMLElement,
    ]),
  );

  const editorMain = {
    scrollTop: opts.editorScrollTop ?? 0,
    scrollHeight: opts.editorScrollHeight ?? 2000,
    getBoundingClientRect: () => ({
      top: editorTop,
      bottom: editorTop + 600,
      left: 0,
      right: 500,
      width: 500,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  };

  return {
    querySelector: (sel: string) => {
      if (sel === ".editor-main") return editorMain;
      const mark = /^\.editor-canvas \[data-comment-id="(.+)"\]$/.exec(sel);
      if (mark) return marks.get(mark[1]) ?? null;
      const card = /^\[data-comment-card-id="(.+)"\]$/.exec(sel);
      if (card) return cards.get(card[1]) ?? null;
      return null;
    },
  } as unknown as HTMLElement;
}

describe("computeCommentCardLayout", () => {
  it("aligns cards to mark Y and stacks on collision", () => {
    const shell = fakeShell({
      marks: [
        { id: "a", top: 40 },
        { id: "b", top: 50 },
      ],
      cards: [
        { id: "a", height: 80 },
        { id: "b", height: 80 },
      ],
    });
    const layout = computeCommentCardLayout(shell, ["a", "b"]);
    expect(layout.tops.get("a")).toBe(40);
    // b wants 50 but a occupies through 40+80+gap → 128
    expect(layout.tops.get("b")).toBe(128);
    expect(layout.stackHeight).toBeGreaterThanOrEqual(128 + 80);
  });
});

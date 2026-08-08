/** Word-like vertical layout: comment cards align to text anchors. */

const CARD_GAP = 8;
const STACK_PAD = 8;

export type CommentCardLayout = {
  /** Top offset (px) within `.comments-stack` for each comment id. */
  tops: Map<string, number>;
  /** Minimum height of the stack so absolute cards fit. */
  stackHeight: number;
};

/** Place cards at the same document Y as their highlights (editor-main
 * content coordinates), pushing down on collision. Call after cards exist
 * in the DOM so heights can be measured.
 */
export function computeCommentCardLayout(
  shell: HTMLElement,
  commentIds: string[],
): CommentCardLayout {
  const editorMain = shell.querySelector(".editor-main");
  if (!editorMain || commentIds.length === 0) {
    return { tops: new Map(), stackHeight: 0 };
  }

  const editorRect = editorMain.getBoundingClientRect();
  const tops = new Map<string, number>();
  let nextMin = 0;

  for (const id of commentIds) {
    const mark = shell.querySelector(
      `.editor-canvas [data-comment-id="${CSS.escape(id)}"]`,
    );
    const card = shell.querySelector(
      `[data-comment-card-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;

    const markRect = mark?.getBoundingClientRect();
    const ideal = markRect
      ? markRect.top - editorRect.top + editorMain.scrollTop
      : nextMin;

    const top = Math.max(ideal, nextMin);
    tops.set(id, top);

    const height = card?.offsetHeight ?? 96;
    nextMin = top + height + CARD_GAP;
  }

  const stackHeight = Math.max(nextMin + STACK_PAD, editorMain.scrollHeight);

  return { tops, stackHeight };
}

/** Left edge of the comments column in shell-local coordinates (gutter). */
export function commentsGutterX(shell: HTMLElement): number | null {
  const panel = shell.querySelector(".document-comments");
  if (!panel) return null;
  const shellRect = shell.getBoundingClientRect();
  return panel.getBoundingClientRect().left - shellRect.left;
}

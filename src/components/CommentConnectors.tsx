import { useEffect, useState, type RefObject } from "react";
import { commentsGutterX } from "../lib/commentLayout";

type Link = {
  id: string;
  d: string;
  active: boolean;
  resolved: boolean;
  opacity: number;
};

type Props = {
  shellRef: RefObject<HTMLElement | null>;
  commentIds: string[];
  activeId: string | null;
  resolvedById: ReadonlyMap<string, boolean>;
  layoutTick: number;
};

/** Short cubic staying in the gutter between editor and comments. */
function gutterPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const span = Math.max(12, x2 - x1);
  const dx = Math.min(36, span * 0.55);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/** Cached per-id DOM refs, rebuilt only when the comment set / doc layout changes. */
type MarkCardRefs = Map<string, { mark: Element; card: Element }>;

function buildMarkCardRefs(shell: HTMLElement, commentIds: string[]): MarkCardRefs {
  const refs: MarkCardRefs = new Map();
  for (const id of commentIds) {
    const mark = shell.querySelector(
      `.editor-canvas [data-comment-id="${CSS.escape(id)}"]`,
    );
    const card = shell.querySelector(
      `[data-comment-card-id="${CSS.escape(id)}"]`,
    );
    if (mark && card) refs.set(id, { mark, card });
  }
  return refs;
}

function measureLinks(
  shell: HTMLElement,
  editorMain: Element,
  commentsScroll: Element,
  refs: MarkCardRefs,
  activeId: string | null,
  resolvedById: ReadonlyMap<string, boolean>,
): Link[] {
  const shellRect = shell.getBoundingClientRect();
  const gutter = commentsGutterX(shell);
  if (gutter == null) return [];

  const editorRect = editorMain.getBoundingClientRect();
  const panelRect = commentsScroll.getBoundingClientRect();
  // Start just left of the comments panel (in the splitter/gutter).
  const x1 = Math.max(0, gutter - 4);
  const links: Link[] = [];

  for (const [id, { mark, card }] of refs) {
    const markRect = mark.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    const markVisible =
      markRect.bottom > editorRect.top && markRect.top < editorRect.bottom;
    const cardVisible =
      cardRect.bottom > panelRect.top && cardRect.top < panelRect.bottom;
    if (!markVisible && !cardVisible) continue;

    let y1 = markRect.top + Math.min(10, markRect.height / 2);
    let y2 = cardRect.top + Math.min(14, cardRect.height / 2);
    let opacity = markVisible && cardVisible ? 0.9 : 0.35;

    if (y1 < editorRect.top) y1 = editorRect.top;
    else if (y1 > editorRect.bottom) y1 = editorRect.bottom;
    if (y2 < panelRect.top) y2 = panelRect.top;
    else if (y2 > panelRect.bottom) y2 = panelRect.bottom;

    const x2 = cardRect.left - shellRect.left;
    if (x2 - x1 < 4) continue;

    links.push({
      id,
      d: gutterPath(x1, y1 - shellRect.top, x2, y2 - shellRect.top),
      active: activeId === id,
      resolved: resolvedById.get(id) === true,
      opacity,
    });
  }
  return links;
}

/**
 * Thin Word-style curves in the gutter only (never across body text).
 */
export function CommentConnectors({
  shellRef,
  commentIds,
  activeId,
  resolvedById,
  layoutTick,
}: Props) {
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || commentIds.length === 0) {
      setLinks([]);
      return;
    }

    const editorMain = shell.querySelector(".editor-main");
    const commentsScroll = shell.querySelector(".comments-scroll");
    if (!editorMain || !commentsScroll) {
      setLinks([]);
      return;
    }

    // Resolved once per (commentIds/layoutTick) change, not on every scroll
    // frame — avoids a `querySelector` + `CSS.escape` pass per comment on
    // every scroll tick (the same scroller used for edge-auto-scroll while
    // dragging a selection).
    const refs = buildMarkCardRefs(shell, commentIds);

    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = shell.getBoundingClientRect();
        setSize({ w: rect.width, h: rect.height });
        setLinks(
          measureLinks(shell, editorMain, commentsScroll, refs, activeId, resolvedById),
        );
      });
    };

    update();

    editorMain.addEventListener("scroll", update, { passive: true });
    commentsScroll.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    const ro = new ResizeObserver(update);
    ro.observe(shell);
    ro.observe(editorMain);
    ro.observe(commentsScroll);

    return () => {
      cancelAnimationFrame(raf);
      editorMain.removeEventListener("scroll", update);
      commentsScroll.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [shellRef, commentIds, activeId, resolvedById, layoutTick]);

  if (links.length === 0 || size.w <= 0) return null;

  return (
    <svg
      className="comment-connectors"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      {links.map((link) => (
        <path
          key={link.id}
          className={
            link.active
              ? "comment-connector-path is-active"
              : link.resolved
                ? "comment-connector-path is-resolved"
                : "comment-connector-path"
          }
          d={link.d}
          style={{ opacity: link.opacity }}
          fill="none"
        />
      ))}
    </svg>
  );
}

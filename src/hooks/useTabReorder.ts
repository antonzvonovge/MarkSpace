import { useCallback, useRef, useState, type DragEvent } from "react";

type TabReorderBind = {
  draggable: true;
  className: string;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  /** Call from click handlers — returns true if the click should be ignored (post-drag). */
  shouldIgnoreClick: () => boolean;
};

/**
 * Horizontal tab-bar HTML5 DnD. Drop targets use left/right half of the tab
 * to choose insert position; `onReorder(from, to)` receives final indices
 * after adjusting for the removed source item.
 */
export function useTabReorder(
  tabCount: number,
  onReorder: (fromIndex: number, toIndex: number) => void,
): (index: number) => TabReorderBind {
  const dragFrom = useRef<number | null>(null);
  const ignoreClick = useRef(false);
  const ignoreClickTimer = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  /** Visual insert marker: gap index before that tab (tabCount = after last). */
  const [dropGap, setDropGap] = useState<number | null>(null);

  const armIgnoreClick = useCallback(() => {
    ignoreClick.current = true;
    if (ignoreClickTimer.current != null) {
      window.clearTimeout(ignoreClickTimer.current);
    }
    // Browsers often omit the post-drop click; expire so the next real click works.
    ignoreClickTimer.current = window.setTimeout(() => {
      ignoreClick.current = false;
      ignoreClickTimer.current = null;
    }, 120);
  }, []);

  const bind = useCallback(
    (index: number): TabReorderBind => {
      const classes = [
        draggingIndex === index ? "is-dragging" : "",
        dropGap === index ? "is-drop-before" : "",
        dropGap === tabCount && index === tabCount - 1 ? "is-drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        draggable: true,
        className: classes,
        onDragStart: (e) => {
          if ((e.target as HTMLElement).closest(".editor-tab-close")) {
            e.preventDefault();
            return;
          }
          dragFrom.current = index;
          ignoreClick.current = false;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(index));
          setDraggingIndex(index);
        },
        onDragEnd: () => {
          dragFrom.current = null;
          setDraggingIndex(null);
          setDropGap(null);
        },
        onDragOver: (e) => {
          if (dragFrom.current == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          setDropGap(before ? index : index + 1);
        },
        onDragLeave: (e) => {
          const related = e.relatedTarget as Node | null;
          if (related && e.currentTarget.contains(related)) return;
          setDropGap((g) => (g === index || g === index + 1 ? null : g));
        },
        onDrop: (e) => {
          e.preventDefault();
          const from = dragFrom.current;
          const rect = e.currentTarget.getBoundingClientRect();
          const before = e.clientX < rect.left + rect.width / 2;
          let to = before ? index : index + 1;
          setDraggingIndex(null);
          setDropGap(null);
          dragFrom.current = null;
          if (from == null) return;
          if (from < to) to -= 1;
          if (from === to) return;
          armIgnoreClick();
          onReorder(from, to);
        },
        shouldIgnoreClick: () => {
          if (!ignoreClick.current) return false;
          ignoreClick.current = false;
          if (ignoreClickTimer.current != null) {
            window.clearTimeout(ignoreClickTimer.current);
            ignoreClickTimer.current = null;
          }
          return true;
        },
      };
    },
    [armIgnoreClick, draggingIndex, dropGap, onReorder, tabCount],
  );

  return bind;
}

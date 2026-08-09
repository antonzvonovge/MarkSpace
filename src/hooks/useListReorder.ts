import { useCallback, useRef, useState, type DragEvent } from "react";

type ListReorderBind = {
  draggable: true;
  className: string;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDragLeave: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  shouldIgnoreClick: () => boolean;
};

/**
 * Vertical list HTML5 DnD. Drop targets use top/bottom half of the row
 * to choose insert position; `onReorder(from, to)` receives final indices
 * after adjusting for the removed source item.
 */
export function useListReorder(
  itemCount: number,
  onReorder: (fromIndex: number, toIndex: number) => void,
): (index: number) => ListReorderBind {
  const dragFrom = useRef<number | null>(null);
  const ignoreClick = useRef(false);
  const ignoreClickTimer = useRef<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  /** Visual insert marker: gap index before that item (itemCount = after last). */
  const [dropGap, setDropGap] = useState<number | null>(null);

  const armIgnoreClick = useCallback(() => {
    ignoreClick.current = true;
    if (ignoreClickTimer.current != null) {
      window.clearTimeout(ignoreClickTimer.current);
    }
    ignoreClickTimer.current = window.setTimeout(() => {
      ignoreClick.current = false;
      ignoreClickTimer.current = null;
    }, 120);
  }, []);

  const bind = useCallback(
    (index: number): ListReorderBind => {
      const classes = [
        draggingIndex === index ? "is-dragging" : "",
        dropGap === index ? "is-drop-before" : "",
        dropGap === itemCount && index === itemCount - 1 ? "is-drop-after" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        draggable: true,
        className: classes,
        onDragStart: (e) => {
          if ((e.target as HTMLElement).closest("button, a, input")) {
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
          const before = e.clientY < rect.top + rect.height / 2;
          const next = before ? index : index + 1;
          setDropGap((g) => (g === next ? g : next));
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
          const before = e.clientY < rect.top + rect.height / 2;
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
    [armIgnoreClick, draggingIndex, dropGap, itemCount, onReorder],
  );

  return bind;
}

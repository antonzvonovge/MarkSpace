import { useEffect, useRef } from "react";

/**
 * Maps mouse-wheel deltas to horizontal scroll on overflow-x containers
 * (including overflow-x: hidden, where the browser will not scroll on its own).
 */
export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;

      let dx = event.deltaX;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        dx = event.deltaY;
      }
      if (dx === 0) return;

      event.preventDefault();
      el.scrollLeft += dx;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}

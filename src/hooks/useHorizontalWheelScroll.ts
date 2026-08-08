import { useEffect, useRef } from "react";

/**
 * Maps vertical mouse-wheel deltas to horizontal scroll on overflow-x containers
 * (browser default only scrolls horizontally via the scrollbar, Shift+wheel, or
 * trackpad horizontal gestures).
 */
export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      // Trackpad / Shift+wheel already provide deltaX — leave those alone.
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      if (event.deltaY === 0) return;

      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) return;

      event.preventDefault();
      el.scrollLeft += event.deltaY;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}
